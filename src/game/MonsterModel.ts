import * as THREE from 'three';
import type { MonsterDef } from '../../shared/types';
import { CharacterModel } from './CharacterModel';

/**
 * 몬스터 겉모습. 모양(slime/beast/humanoid/golem)마다 다르게 만들고,
 * 예비 동작 빛(흰색 = 일반, 붉은색 = 강공격), 맞은 순간 번쩍임, 걷기·눕기 연출을 한다.
 */
export class MonsterModel {
  readonly root = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly glowMats: THREE.MeshStandardMaterial[] = [];
  private human: CharacterModel | null = null;
  private legs: THREE.Object3D[] = [];
  private flashT = 0;
  private walk = 0;
  private spin = 0;
  private glow: THREE.Mesh | null = null;
  /** 맞은 반응: 남은 시간·방향·세기 */
  private hitT = 0;
  private hitDur = 0.2;
  private hitDir = new THREE.Vector2();
  private hitPower = 1;
  /** 맞아서 순간적으로 밀린 만큼(세계 좌표) — 위치에 더해서 그린다 */
  readonly recoil = new THREE.Vector3();

  constructor(readonly def: MonsterDef) {
    const m = def.model;
    const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const x = new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
      this.mats.push(x);
      return x;
    };
    const dark = new THREE.Color(m.color).multiplyScalar(0.6).getStyle();
    const add = (g: THREE.BufferGeometry, mt: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(g, mt);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.inner.add(mesh);
      return mesh;
    };
    const eye = mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.3 });
    const pupil = mat('#111111');
    if (m.shape === 'slime') {
      const body = add(new THREE.SphereGeometry(0.55, 16, 12), mat(m.color, { transparent: true, opacity: 0.92, roughness: 0.25 }), 0, 0.42, 0);
      body.scale.set(1, 0.78, 1);
      for (const s of [-1, 1]) {
        add(new THREE.SphereGeometry(0.1, 8, 6), eye, 0.18 * s, 0.55, 0.42);
        add(new THREE.SphereGeometry(0.05, 6, 5), pupil, 0.18 * s, 0.55, 0.5);
      }
    } else if (m.shape === 'beast') {
      const body = add(new THREE.CapsuleGeometry(0.28, 0.75, 4, 10), mat(m.color), 0, 0.62, 0);
      body.rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.36, 0.32, 0.45), mat(m.color), 0, 0.82, 0.62);
      add(new THREE.BoxGeometry(0.2, 0.14, 0.22), mat(dark), 0, 0.74, 0.92);
      for (const s of [-1, 1]) {
        add(new THREE.ConeGeometry(0.07, 0.2, 4), mat(dark), 0.12 * s, 1.04, 0.56);
        add(new THREE.SphereGeometry(0.04, 6, 5), mat('#ffcc40', { emissive: '#ff9900', emissiveIntensity: 0.8 }), 0.1 * s, 0.88, 0.85);
      }
      const tail = add(new THREE.CylinderGeometry(0.04, 0.07, 0.5, 5), mat(dark), 0, 0.78, -0.62);
      tail.rotation.x = -0.9;
      for (const [x, z] of [[-0.16, 0.36], [0.16, 0.36], [-0.16, -0.36], [0.16, -0.36]]) {
        const leg = add(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 5), mat(dark), x, 0.25, z);
        this.legs.push(leg);
      }
    } else if (m.shape === 'golem') {
      add(new THREE.BoxGeometry(1.1, 1.2, 0.8), mat(m.color, { roughness: 1 }), 0, 1.5, 0);
      add(new THREE.BoxGeometry(0.6, 0.5, 0.55), mat(dark, { roughness: 1 }), 0, 2.35, 0.05);
      add(new THREE.SphereGeometry(0.09, 6, 5), mat('#ff6030', { emissive: '#ff4010', emissiveIntensity: 1.5 }), 0, 2.4, 0.33);
      for (const s of [-1, 1]) {
        this.legs.push(add(new THREE.BoxGeometry(0.38, 0.9, 0.4), mat(dark, { roughness: 1 }), 0.3 * s, 0.45, 0));
        add(new THREE.BoxGeometry(0.35, 1.0, 0.35), mat(m.color, { roughness: 1 }), 0.78 * s, 1.4, 0.1);
      }
    } else {
      this.human = new CharacterModel({ body: m.color, weapon: m.weapon ?? null, skin: '#c9a080', enemy: true });
      this.inner.add(this.human.root);
    }
    // 예비 동작 빛(발밑 원)
    const gm = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
    this.glow = new THREE.Mesh(new THREE.RingGeometry(def.radius * 1.1, def.radius * 1.6, 24), gm);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.04;
    this.root.add(this.glow);
    this.glowMats.push(...this.mats);
    this.inner.scale.setScalar(m.scale);
    this.root.add(this.inner);
  }

  /** 공격 예고 빛. strength 0~1 */
  telegraph(color: string | null, strength = 0): void {
    const gm = this.glow!.material as THREE.MeshBasicMaterial;
    gm.opacity = color ? 0.25 + strength * 0.55 : 0;
    if (color) gm.color.set(color);
    this.human?.setGlow(color, strength * 2);
    for (const m of this.glowMats) {
      m.emissive.set(color ?? '#000000');
      m.emissiveIntensity = color ? strength * 0.35 : 0;
    }
  }

  flash(power = 1): void {
    this.flashT = 0.1 + power * 0.06;
    this.human?.flash(0.1 + power * 0.06);
  }

  /** 맞았다: 반대쪽으로 움찔 밀리고, 찌그러졌다 펴지고, 부르르 떤다. power 1 = 보통, 클수록 크게 */
  kick(dx: number, dz: number, power = 1): void {
    this.hitT = this.hitDur = 0.16 + power * 0.06;
    this.hitDir.set(dx, dz).normalize();
    this.hitPower = power;
    this.flash(power);
  }

  /** windup: 0~1 예비 동작 진행(뒤로 젖힘), lunge: 공격 중 앞으로 숙임 */
  animate(dt: number, speed: number, air: boolean, down: number, windup: number, attacking: boolean): void {
    this.walk += dt * (speed > 0.3 ? 4 + speed * 1.5 : 0);
    const sw = speed > 0.3 ? Math.sin(this.walk) : 0;
    this.legs.forEach((l, i) => (l.rotation.x = sw * 0.6 * (i % 2 ? 1 : -1)));
    if (this.human) {
      this.human.pose = attacking ? [0, -40] : windup > 0 ? [0, 30 + windup * 55] : [-20, -50];
      this.human.applyPose();
      this.human.animate(dt, speed, air, down);
    } else {
      // 공중에 띄워지면 뒤로 젖혀져 휘청(착지하면 눕는다)
      this.spin += air ? dt * 8 : 0;
      this.inner.rotation.x = down > 0 ? -1.3 * down : air ? -0.7 + Math.sin(this.spin) * 0.25 : -windup * 0.35 + (attacking ? 0.3 : 0);
      if (this.def.model.shape === 'slime') {
        const sq = 1 + Math.sin(this.walk * 1.2) * 0.08 + windup * 0.25;
        this.inner.scale.set(this.def.model.scale * (1 / Math.sqrt(sq)), this.def.model.scale * (1 / sq) * (attacking ? 1.25 : 1), this.def.model.scale * (1 / Math.sqrt(sq)));
      }
    }
    if (this.hitT > 0) {
      this.hitT = Math.max(0, this.hitT - dt);
      const k = this.hitT / this.hitDur;
      const p = this.hitPower;
      const back = Math.sin(k * Math.PI) * 0.34 * p;
      const jitter = k * 0.07 * p;
      this.recoil.set(this.hitDir.x * back + (Math.random() - 0.5) * jitter, 0, this.hitDir.y * back + (Math.random() - 0.5) * jitter);
      // 맞는 순간 눌렸다가(납작) 펴지며 되돌아옴
      const s = this.def.model.scale;
      const sq = 1 - Math.sin(k * Math.PI) * 0.2 * Math.min(1.6, p);
      this.inner.scale.set(s * (2 - sq) ** 0.5, s * sq, s * (2 - sq) ** 0.5);
      this.inner.rotation.z = (this.hitDir.x * Math.cos(this.root.rotation.y) - this.hitDir.y * Math.sin(this.root.rotation.y)) * -0.35 * k * Math.min(1.5, p);
    } else {
      this.recoil.set(0, 0, 0);
      this.inner.rotation.z = 0;
      if (this.def.model.shape !== 'slime') this.inner.scale.setScalar(this.def.model.scale);
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      for (const m of this.mats) {
        m.emissive.set('#ffffff');
        m.emissiveIntensity = this.flashT > 0 ? 1.6 : 0;
      }
    }
  }

  dispose(): void {
    // 사람형은 CharacterModel의 공유 도형을 쓰므로 직접 만든 도형만 지운다
    for (const o of [...this.inner.children, this.glow!]) {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    }
    for (const m of this.mats) m.dispose();
    this.human?.dispose();
  }
}

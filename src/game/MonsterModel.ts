import * as THREE from 'three';
import type { MonsterDef } from '../../shared/types';
import { CharacterModel } from './CharacterModel';
import { beast, brute, Builder, bat, ghost, golem, humanoidDeco, slime, spider } from './MonsterParts';

const SHAPES = { slime, beast, golem, spider, bat, ghost, brute } as const;

/**
 * 몬스터 겉모습: 만화풍 3단 명암 + 테두리. 모양(slime·beast·golem·spider·bat·ghost·brute·humanoid)마다 부위를 만들고
 * (`MonsterParts.ts`), 걷기(다리 엇갈림)·날갯짓·떠다니기·꼬리 흔들기·숨쉬기·입 벌리기를 움직인다.
 * 예비 동작 빛(흰색 = 일반, 붉은색 = 강공격), 맞은 순간 번쩍임·찌그러짐·밀림, 공중에서 휘청·눕기.
 */
export class MonsterModel {
  readonly root = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly mats: THREE.MeshToonMaterial[] = [];
  private readonly extraMats: THREE.Material[] = [];
  private readonly b: Builder | null = null;
  private human: CharacterModel | null = null;
  private flashT = 0;
  private walk = 0;
  private time = Math.random() * 10;
  private spin = 0;
  private glow: THREE.Mesh | null = null;
  /** 맞은 반응: 남은 시간·방향·세기 */
  private hitT = 0;
  private hitDur = 0.2;
  private hitDir = new THREE.Vector2();
  private hitPower = 1;
  /** 맞아서 순간적으로 밀린 만큼(세계 좌표) — 위치에 더해서 그린다 */
  readonly recoil = new THREE.Vector3();
  /** 떠 있는 높이(박쥐·원혼): 위치에 더해서 그린다 */
  get hover(): number {
    return this.b?.rig.hover ?? 0;
  }

  constructor(readonly def: MonsterDef) {
    const m = def.model;
    const build = SHAPES[m.shape as keyof typeof SHAPES];
    if (build) {
      this.b = new Builder(this.inner, def);
      build(this.b, m.color);
      this.mats.push(...this.b.mats);
      this.extraMats.push(...this.b.glowMats);
    } else {
      this.human = new CharacterModel({ body: m.color, weapon: m.weapon ?? null, skin: '#c9a080', enemy: true });
      this.inner.add(this.human.root);
      if (m.deco?.length) {
        this.b = new Builder(this.inner, def);
        humanoidDeco(this.b, 1.85);
        this.mats.push(...this.b.mats);
        this.extraMats.push(...this.b.glowMats);
      }
    }
    // 예비 동작 빛(발밑 원)
    const gm = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
    this.extraMats.push(gm);
    this.glow = new THREE.Mesh(new THREE.RingGeometry(def.radius * 1.1, def.radius * 1.6, 24), gm);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.04;
    this.root.add(this.glow);
    // 보스는 발밑에 은은한 기운
    if (def.boss) {
      const am = new THREE.MeshBasicMaterial({ color: '#ff5030', transparent: true, opacity: 0.18, depthWrite: false });
      this.extraMats.push(am);
      const aura = new THREE.Mesh(new THREE.CircleGeometry(def.radius * 2.2, 32), am);
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = 0.03;
      this.root.add(aura);
    }
    this.inner.scale.setScalar(m.scale);
    this.root.add(this.inner);
  }

  /** 공격 예고 빛. strength 0~1 */
  telegraph(color: string | null, strength = 0): void {
    const gm = this.glow!.material as THREE.MeshBasicMaterial;
    gm.opacity = color ? 0.25 + strength * 0.55 : 0;
    if (color) gm.color.set(color);
    this.human?.setGlow(color, strength * 2);
    if (this.flashT > 0) return;
    for (const m of this.mats) {
      m.emissive.set(color ?? '#000000');
      m.emissiveIntensity = color ? strength * 0.4 : 0;
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

  /** windup: 0~1 예비 동작 진행(뒤로 젖힘), attacking: 공격 판정 중 */
  animate(dt: number, speed: number, air: boolean, down: number, windup: number, attacking: boolean): void {
    this.time += dt;
    this.walk += dt * (speed > 0.3 ? 4 + speed * 1.5 : 0);
    const moving = speed > 0.3;
    const s = this.def.model.scale;
    if (this.human) {
      this.human.pose = attacking ? [0, -40] : windup > 0 ? [0, 30 + windup * 55] : [-20, -50];
      this.human.applyPose();
      this.human.animate(dt, speed, air, down);
    }
    const rig = this.b?.rig;
    if (rig && !this.human) {
      const sw = Math.sin(this.walk);
      for (const l of rig.legs) l.o.rotation[l.axis] = moving ? Math.sin(this.walk + l.phase) * l.amp : 0;
      // 날갯짓: 공격 직전엔 크게 퍼덕
      const flap = Math.sin(this.time * (attacking || windup > 0 ? 22 : 14));
      rig.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * (0.15 + flap * 0.65)));
      rig.tail.forEach((t, i) => (t.rotation.y = Math.sin(this.time * 3 + i * 0.7) * (0.25 + (moving ? 0.2 : 0))));
      if (rig.jaw) rig.jaw.rotation.x = attacking ? 0.55 : windup * 0.4 + Math.max(0, Math.sin(this.time * 1.3)) * 0.04;
      for (const a of rig.arms) a.rotation.x = attacking ? -1.6 : windup > 0 ? -windup * 2.2 : moving ? sw * 0.35 : Math.sin(this.time * 2) * 0.05;
      if (rig.chest) {
        const breathe = 1 + Math.sin(this.time * 2.2) * 0.025;
        rig.chest.scale.set(1, breathe, 1);
      }
      // 떠 있는 몬스터는 위아래로 흔들
      if (rig.hover) this.inner.position.y = rig.hover + Math.sin(this.time * (rig.wings.length ? 6 : 2)) * (rig.wings.length ? 0.12 : 0.08) - (down > 0 ? rig.hover * 0.8 : 0);
      // 공중에 띄워지면 뒤로 젖혀져 휘청(착지하면 눕는다)
      this.spin += air ? dt * 8 : 0;
      this.inner.rotation.x = down > 0 ? -1.3 * down : air ? -0.7 + Math.sin(this.spin) * 0.25 : -windup * 0.35 + (attacking ? 0.3 : 0) + (moving && !rig.hover ? Math.sin(this.walk * 2) * 0.03 : 0);
      if (this.def.model.shape === 'slime' && this.hitT <= 0) {
        const sq = 1 + Math.sin(this.walk * 1.2) * 0.08 + windup * 0.25 + Math.sin(this.time * 3) * 0.03;
        this.inner.scale.set(s / Math.sqrt(sq), (s / sq) * (attacking ? 1.25 : 1), s / Math.sqrt(sq));
      }
    } else if (rig) {
      for (const t of rig.tail) t.rotation.y += dt * 1.5;
    }
    if (this.hitT > 0) {
      this.hitT = Math.max(0, this.hitT - dt);
      const k = this.hitT / this.hitDur;
      const p = this.hitPower;
      const back = Math.sin(k * Math.PI) * 0.34 * p;
      const jitter = k * 0.07 * p;
      this.recoil.set(this.hitDir.x * back + (Math.random() - 0.5) * jitter, 0, this.hitDir.y * back + (Math.random() - 0.5) * jitter);
      // 맞는 순간 눌렸다가(납작) 펴지며 되돌아옴
      const sq = 1 - Math.sin(k * Math.PI) * 0.2 * Math.min(1.6, p);
      this.inner.scale.set(s * (2 - sq) ** 0.5, s * sq, s * (2 - sq) ** 0.5);
      this.inner.rotation.z = (this.hitDir.x * Math.cos(this.root.rotation.y) - this.hitDir.y * Math.sin(this.root.rotation.y)) * -0.35 * k * Math.min(1.5, p);
    } else {
      this.recoil.set(0, 0, 0);
      this.inner.rotation.z = 0;
      if (this.def.model.shape !== 'slime') this.inner.scale.setScalar(s);
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
    // 도형은 몬스터끼리 공유하므로 지우지 않고, 재질과 발밑 원만 지운다
    this.glow?.geometry.dispose();
    for (const m of this.mats) m.dispose();
    for (const m of this.extraMats) m.dispose();
    this.human?.dispose();
  }
}

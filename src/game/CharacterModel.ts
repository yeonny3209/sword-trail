import * as THREE from 'three';

export interface ModelStyle {
  body: string;
  hair?: string;
  skin?: string;
  weapon?: { kind: 'sword' | 'greatsword' | 'dual' | 'runeblade'; length: number; width: number; color: string } | null;
  scale?: number;
}

const DEG = Math.PI / 180;
const geo = {
  torso: new THREE.CapsuleGeometry(0.3, 0.55, 4, 10),
  head: new THREE.SphereGeometry(0.24, 14, 10),
  hair: new THREE.SphereGeometry(0.255, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  leg: new THREE.CapsuleGeometry(0.11, 0.42, 3, 6),
  arm: new THREE.CapsuleGeometry(0.085, 0.38, 3, 6),
  blade: new THREE.BoxGeometry(1, 1, 1),
};

/**
 * 저폴리곤 캐릭터: 몸통·머리·팔다리·무기. 플레이어·NPC·원격 플레이어가 함께 쓴다.
 * 무기는 어깨 피벗을 [수평각, 수직각]으로 돌려 자세를 만든다(공격 연출은 이 각도를 움직인다).
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly weaponPivots: THREE.Group[] = [];
  readonly bladeTips: THREE.Object3D[] = [];
  private readonly legs: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly bladeMats: THREE.MeshStandardMaterial[] = [];
  private flashT = 0;
  private walk = 0;
  /** 무기 자세 [수평각, 수직각](도) — 오른손 기준, 왼손은 좌우 반전 */
  pose: [number, number] = [-20, -60];

  constructor(style: ModelStyle) {
    const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
      this.mats.push(m);
      return m;
    };
    const bodyMat = mat(style.body);
    const darker = new THREE.Color(style.body).multiplyScalar(0.55).getStyle();
    const skin = mat(style.skin ?? '#f1c9a5');
    const legMat = mat('#3a3530');

    const torso = new THREE.Mesh(geo.torso, bodyMat);
    torso.position.y = 0.98;
    const head = new THREE.Mesh(geo.head, skin);
    head.position.y = 1.6;
    const hair = new THREE.Mesh(geo.hair, mat(style.hair ?? darker));
    hair.position.y = 1.62;
    hair.rotation.x = -0.25;
    this.body.add(torso, head, hair);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(geo.leg, legMat);
      leg.position.set(0.14 * s, 0.38, 0);
      this.legs.push(leg);
      const arm = new THREE.Mesh(geo.arm, bodyMat);
      arm.position.set(0.38 * s, 1.08, 0.02);
      this.arms.push(arm);
      this.body.add(leg, arm);
    }
    this.root.add(this.body);

    const w = style.weapon;
    if (w) {
      const hands = w.kind === 'dual' ? [1, -1] : [1];
      for (const side of hands) {
        const pivot = new THREE.Group();
        pivot.position.set(0.4 * side, 1.12, 0.12);
        const bladeMat = new THREE.MeshStandardMaterial({ color: w.color, metalness: 0.7, roughness: 0.3, emissive: '#000000' });
        this.bladeMats.push(bladeMat);
        const blade = new THREE.Mesh(geo.blade, bladeMat);
        blade.scale.set(0.022 * w.width + 0.02, 0.08 * w.width + 0.02, w.length);
        blade.position.z = 0.15 + w.length / 2;
        const guard = new THREE.Mesh(geo.blade, mat('#5a4a32'));
        guard.scale.set(0.05, 0.22 * Math.max(0.8, w.width * 0.8), 0.05);
        guard.position.z = 0.13;
        const tip = new THREE.Object3D();
        tip.position.z = 0.15 + w.length;
        pivot.add(blade, guard, tip);
        pivot.userData.side = side;
        pivot.userData.bladeMat = bladeMat;
        blade.castShadow = true;
        this.weaponPivots.push(pivot);
        this.bladeTips.push(tip);
        this.root.add(pivot);
      }
    }
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    if (style.scale) this.root.scale.setScalar(style.scale);
    this.applyPose();
  }

  applyPose(): void {
    for (const p of this.weaponPivots) {
      const side = p.userData.side as number;
      p.rotation.set(0, 0, 0, 'YXZ');
      p.rotation.y = this.pose[0] * DEG * side;
      p.rotation.x = -this.pose[1] * DEG;
    }
  }

  /** 검에 빛(스킬 준비 등) */
  setGlow(color: string | null, strength = 1): void {
    for (const p of this.weaponPivots) {
      const m = p.userData.bladeMat as THREE.MeshStandardMaterial;
      m.emissive.set(color ?? '#000000');
      m.emissiveIntensity = color ? strength : 0;
    }
  }

  flash(seconds = 0.12): void {
    this.flashT = seconds;
  }

  /**
   * 매 렌더 프레임: 걷기 흔들림, 공중 자세, 맞은 순간 번쩍임.
   * speed: 수평 속도(m/s), air: 공중 여부, down: 누움(0~1)
   */
  animate(dt: number, speed: number, air: boolean, down = 0): void {
    const moving = speed > 0.3 && !air;
    this.walk += dt * (moving ? 6 + speed * 1.2 : 0);
    const swing = moving ? Math.sin(this.walk) * Math.min(1, speed / 5) * 0.7 : 0;
    this.legs[0].rotation.x = air ? -0.7 : swing;
    this.legs[1].rotation.x = air ? 0.4 : -swing;
    this.arms[0].rotation.x = -swing * 0.6;
    this.arms[1].rotation.x = swing * 0.6;
    this.body.position.y = moving ? Math.abs(Math.cos(this.walk)) * 0.06 : 0;
    this.body.rotation.x = down > 0 ? -down * 1.45 : moving ? 0.12 : 0;
    this.body.position.z = down > 0 ? -down * 0.6 : 0;
    if (this.flashT > 0) {
      this.flashT -= dt;
      const on = this.flashT > 0;
      for (const m of this.mats) {
        m.emissive.setRGB(1, 1, 1);
        m.emissiveIntensity = on ? 0.8 : 0;
      }
    }
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const m of this.bladeMats) m.dispose();
  }
}

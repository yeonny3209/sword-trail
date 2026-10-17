import * as THREE from 'three';
import type { WeaponKind } from '../../shared/types';
import { bladeGeo, DEG, defaultLook, GEO, guardGeo, outlineOf, OUTLINE_MAT, toon, type Look } from './CharacterParts';

export interface ModelStyle {
  body: string;
  hair?: string;
  skin?: string;
  weapon?: { kind: WeaponKind; length: number; width: number; color: string } | null;
  scale?: number;
  look?: Look;
  /** 적(병사형 몬스터): 기본 모습에 투구 */
  enemy?: boolean;
}

/** 팔+무기 회전축(어깨)에서 손·칼날까지 거리 */
const HAND_Z = 0.5;
const BLADE_Z = 0.6;

/**
 * 만화풍 캐릭터: 테두리 + 3단 명암, 잘록한 몸통·가슴 갑옷·허리띠·어깨 갑옷·망토, 얼굴(눈 깜빡임)·머리 모양, 손에 쥔 무기.
 * 플레이어·NPC·원격 플레이어·사람형 몬스터가 함께 쓴다.
 * 무기는 어깨 회전축에 팔과 함께 붙어 있어서, 자세 [수평각, 수직각]을 바꾸면 팔이 검을 쥔 채 휘두른다.
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  /** 몸 전체(눕기·숙이기) */
  readonly body = new THREE.Group();
  /** 상체(허리 위): 휘두를 때 비틀림 */
  private readonly upper = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly eyes = new THREE.Group();
  readonly weaponPivots: THREE.Group[] = [];
  readonly bladeTips: THREE.Object3D[] = [];
  /** 칼날이 시작되는 곳(궤적용) */
  readonly bladeBases: THREE.Object3D[] = [];
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private cape: THREE.Group | null = null;
  private pony: THREE.Mesh | null = null;
  private readonly mats: THREE.MeshToonMaterial[] = [];
  private readonly bladeMats: THREE.MeshToonMaterial[] = [];
  private readonly basics: THREE.Material[] = [];
  private flashT = 0;
  private walk = 0;
  private time = Math.random() * 10;
  private blinkT = 2 + Math.random() * 3;
  /** 무기 자세 [수평각, 수직각](도) — 오른손 기준, 왼손은 좌우 반전 */
  pose: [number, number] = [-20, -60];
  private swingV = 0;
  private prevPose: [number, number] = [-20, -60];

  constructor(style: ModelStyle) {
    const look = style.look ?? defaultLook(style.body, !!style.enemy);
    const m = (color: string, extra: THREE.MeshToonMaterialParameters = {}) => {
      const x = toon(color, extra);
      x.userData.e = x.emissive.clone();
      x.userData.ei = x.emissiveIntensity;
      this.mats.push(x);
      return x;
    };
    const skin = m(style.skin ?? '#f1c9a5');
    const cloth = m(style.body);
    const armor = m(look.armor);
    const accent = m(look.accent);
    const pants = m('#3a3530');
    const boots = m(look.boots);
    const hair = m(style.hair ?? look.hairColor);

    // 하체
    this.body.add(this.part(GEO.pelvis, pants, 0, 0.78, 0));
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.12 * s, 0.8, 0);
      hip.add(this.part(GEO.thigh, pants, 0, -0.2, 0), this.part(GEO.boot, boots, 0, -0.6, 0), this.part(GEO.toe, boots, 0, -0.75, 0.06));
      this.legs.push(hip);
      this.body.add(hip);
    }
    // 상체
    this.upper.position.y = 0.78;
    this.upper.add(this.part(GEO.torso, cloth, 0, 0, 0), this.part(GEO.chest, armor, 0, 0.42, 0.005));
    this.upper.add(this.part(GEO.belt, accent, 0, 0.04, 0), this.part(GEO.buckle, accent, 0, 0.04, 0.19, false));
    this.upper.add(this.part(GEO.neck, skin, 0, 0.71, 0, false));
    if (look.pauldron !== 'none') {
      for (const s of [-1, 1]) this.upper.add(this.part(look.pauldron === 'big' ? GEO.pauldronB : GEO.pauldronS, armor, 0.31 * s, 0.6, 0));
    }
    if (look.cape) {
      const capeMat = m(look.cape, { side: THREE.DoubleSide });
      this.cape = new THREE.Group();
      this.cape.position.set(0, 0.62, -0.19);
      this.cape.add(this.part(GEO.cape, capeMat, 0, 0, 0, false));
      this.upper.add(this.cape);
    }
    this.buildHead(look, skin, hair, armor);
    this.upper.add(this.head);
    this.body.add(this.upper);
    this.root.add(this.body);

    // 팔: 무기를 쥔 손은 무기와 함께 어깨에서 돈다
    const w = style.weapon;
    const hands = !w ? [] : w.kind === 'dual' ? [1, -1] : [1];
    for (const side of [1, -1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.35 * side, 0.55, 0.02);
      this.upper.add(shoulder);
      if (w && hands.includes(side)) this.buildWeaponArm(shoulder, side, w, cloth, skin);
      else {
        shoulder.add(this.part(GEO.hangArm, cloth, 0, -0.26, 0), this.part(GEO.hand, skin, 0, -0.52, 0.02));
        this.arms.push(shoulder);
      }
    }
    if (style.scale) this.root.scale.setScalar(style.scale);
    this.applyPose();
  }

  /** 도형 하나 + 테두리 */
  private part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, outline = true): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    if (outline) mesh.add(new THREE.Mesh(outlineOf(geo, 0.016), OUTLINE_MAT));
    return mesh;
  }

  private basic(color: string): THREE.MeshBasicMaterial {
    const b = new THREE.MeshBasicMaterial({ color });
    this.basics.push(b);
    return b;
  }

  private buildHead(look: Look, skin: THREE.Material, hair: THREE.Material, armor: THREE.Material): void {
    const h = this.head;
    h.position.y = 0.88;
    h.add(this.part(GEO.head, skin, 0, 0, 0));
    const eyeMat = this.basic('#1c1626'), shineMat = this.basic('#ffffff');
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(GEO.eye, eyeMat);
      e.position.set(0.088 * s, 0.01, 0.228);
      const sh = new THREE.Mesh(GEO.shine, shineMat);
      sh.position.set(0.098 * s, 0.03, 0.245);
      this.eyes.add(e, sh);
    }
    h.add(this.eyes);
    if (look.helm) {
      h.add(this.part(GEO.helm, armor, 0, 0.04, 0), this.part(GEO.visor, hair, 0, 0.1, 0.22));
      return;
    }
    if (look.hairStyle === 'none') return;
    const cap = this.part(GEO.hairCap, hair, 0, 0.03, -0.01);
    cap.rotation.x = -0.18;
    h.add(cap);
    const spikes = look.hairStyle === 'spiky' ? 7 : look.hairStyle === 'wild' ? 11 : 0;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 1.6 - Math.PI * 0.3;
      const sp = this.part(GEO.spike, hair, Math.sin(a) * 0.17, 0.18 + Math.cos(i * 2.3) * 0.03, -Math.cos(a) * 0.15 - 0.03);
      sp.rotation.set(-Math.cos(a) * 1.1 - 0.3, 0, -Math.sin(a) * 1.1);
      if (look.hairStyle === 'wild') sp.scale.setScalar(1.35);
      h.add(sp);
    }
    if (look.hairStyle === 'short' || look.hairStyle === 'pony' || look.hairStyle === 'long') {
      const fr = this.part(GEO.fringe, hair, 0, 0.17, 0.19);
      fr.rotation.x = 0.55;
      h.add(fr);
    }
    if (look.hairStyle === 'long') h.add(this.part(GEO.longHair, hair, 0, -0.16, -0.13));
    if (look.hairStyle === 'pony') {
      this.pony = this.part(GEO.pony, hair, 0, 0.04, -0.4);
      this.pony.rotation.x = 0.7;
      h.add(this.pony);
    }
  }

  private buildWeaponArm(shoulder: THREE.Group, side: number, w: NonNullable<ModelStyle['weapon']>, cloth: THREE.Material, skin: THREE.Material): void {
    shoulder.add(this.part(GEO.upperArm, cloth, 0, 0, 0.15), this.part(GEO.foreArm, cloth, 0, 0, 0.36), this.part(GEO.hand, skin, 0, 0, HAND_Z));
    const rune = w.kind === 'runeblade' || w.kind === 'staff' || w.kind === 'scythe';
    const glow = w.kind === 'staff' ? '#ffe070' : w.kind === 'scythe' ? '#b060ff' : '#8a60ff';
    const bladeMat = toon(w.color, { emissive: rune ? glow : w.color, emissiveIntensity: w.kind === 'staff' ? 0.9 : rune ? 0.55 : 0.12 });
    bladeMat.userData.e = bladeMat.emissive.clone();
    bladeMat.userData.ei = bladeMat.emissiveIntensity;
    this.bladeMats.push(bladeMat);
    const metal = toon('#c8a050');
    const grip = toon('#4a3424');
    for (const x of [metal, grip]) {
      x.userData.e = x.emissive.clone();
      x.userData.ei = 0;
      this.mats.push(x);
    }
    const base = new THREE.Object3D();
    const tip = new THREE.Object3D();
    if (w.kind === 'staff') {
      // 지팡이: 긴 막대 + 끝에 빛나는 구슬과 고리
      const L = 0.9 + w.length * 0.9, top = HAND_Z + L * 0.35 + L / 2;
      shoulder.add(this.part(new THREE.CylinderGeometry(0.036, 0.04, L, 8).rotateX(Math.PI / 2), grip, 0, 0, HAND_Z + L * 0.35));
      shoulder.add(this.part(new THREE.TorusGeometry(0.1, 0.022, 6, 14), metal, 0, 0, top - 0.06));
      shoulder.add(this.part(new THREE.SphereGeometry(0.1, 12, 10), bladeMat, 0, 0, top + 0.02, false));
      base.position.z = top - 0.25;
      tip.position.z = top + 0.1;
    } else if (w.kind === 'scythe') {
      // 낫: 긴 자루 + 끝에서 옆으로 휘어진 큰 날
      const L = 1.5, top = HAND_Z - 0.25 + L;
      shoulder.add(this.part(new THREE.CylinderGeometry(0.034, 0.038, L, 8).rotateX(Math.PI / 2), grip, 0, 0, HAND_Z - 0.25 + L / 2));
      const blade = this.part(bladeGeo(0.7 + w.length * 0.5, w.width, true), bladeMat, 0, 0, top - 0.05);
      blade.rotation.y = Math.PI / 2;
      shoulder.add(blade, this.part(new THREE.SphereGeometry(0.06, 8, 6), metal, 0, 0, top, false));
      base.position.set(0.1, 0, top - 0.05);
      tip.position.set(0.7 + w.length * 0.5, 0, top - 0.05);
    } else {
      shoulder.add(this.part(GEO.grip, grip, 0, 0, HAND_Z), this.part(GEO.pommel, metal, 0, 0, HAND_Z - 0.12, false));
      shoulder.add(this.part(guardGeo(w.width), metal, 0, 0, BLADE_Z - 0.03));
      shoulder.add(this.part(bladeGeo(w.length, w.width, w.kind === 'dual'), bladeMat, 0, 0, BLADE_Z));
      base.position.z = BLADE_Z + 0.05;
      tip.position.z = BLADE_Z + w.length;
    }
    shoulder.add(base, tip);
    shoulder.userData.side = side;
    shoulder.userData.bladeMat = bladeMat;
    this.weaponPivots.push(shoulder);
    this.bladeBases.push(base);
    this.bladeTips.push(tip);
  }

  applyPose(): void {
    const dh = this.pose[0] - this.prevPose[0], dv = this.pose[1] - this.prevPose[1];
    this.swingV = Math.max(this.swingV * 0.82, Math.min(120, Math.hypot(dh, dv)));
    this.prevPose = [this.pose[0], this.pose[1]];
    for (const p of this.weaponPivots) {
      const side = p.userData.side as number;
      p.rotation.set(0, 0, 0, 'YXZ');
      p.rotation.y = this.pose[0] * DEG * side;
      p.rotation.x = -this.pose[1] * DEG;
    }
  }

  /** 검에 빛(스킬 준비·타격 순간) */
  setGlow(color: string | null, strength = 1): void {
    for (const m of this.bladeMats) {
      if (color) {
        m.emissive.set(color);
        m.emissiveIntensity = strength;
      } else {
        m.emissive.copy(m.userData.e as THREE.Color);
        m.emissiveIntensity = m.userData.ei as number;
      }
    }
  }

  flash(seconds = 0.12): void {
    this.flashT = seconds;
  }

  /**
   * 매 렌더 프레임: 걷기, 숨쉬기, 망토·머리 흔들림, 눈 깜빡임, 공중 자세, 맞은 순간 번쩍임.
   * speed: 수평 속도(m/s), air: 공중 여부, down: 누움(0~1)
   */
  animate(dt: number, speed: number, air: boolean, down = 0): void {
    this.time += dt;
    const moving = speed > 0.3 && !air;
    this.walk += dt * (moving ? 6 + speed * 1.2 : 0);
    const swing = moving ? Math.sin(this.walk) * Math.min(1, speed / 5) * 0.75 : 0;
    this.legs[0].rotation.x = air ? -0.8 : swing;
    this.legs[1].rotation.x = air ? 0.5 : -swing;
    this.arms.forEach((a, i) => {
      a.rotation.x = air ? -0.6 : (i ? swing : -swing) * 0.7;
      a.rotation.z = (a.position.x > 0 ? 1 : -1) * (air ? 0.5 : 0.08);
    });
    // 숨쉬기·걸을 때 위아래
    const breathe = Math.sin(this.time * 2.2) * 0.012;
    this.upper.scale.set(1 + breathe * 0.5, 1 + breathe, 1 + breathe * 0.5);
    this.body.position.y = moving ? Math.abs(Math.cos(this.walk)) * 0.07 : 0;
    // 휘두를 때 상체가 검을 따라 비틀리고 숙여짐(휘두르는 속도에 비례)
    const lean = down > 0 || air ? 0 : Math.min(0.34, this.swingV * 0.006);
    this.upper.rotation.y = down > 0 || !this.weaponPivots.length ? 0 : this.pose[0] * DEG * 0.22 * Math.min(1, this.swingV / 12);
    this.upper.rotation.x = lean + (moving ? 0.1 : 0);
    this.body.rotation.x = down > 0 ? -down * 1.45 : 0;
    this.body.position.z = down > 0 ? -down * 0.6 : 0;
    this.head.rotation.x = Math.sin(this.time * 1.1) * 0.03;
    if (this.cape) this.cape.rotation.x = 0.12 + Math.min(0.9, speed * 0.13) + (air ? 0.6 : 0) + Math.sin(this.time * 3.1 + speed) * 0.05;
    if (this.pony) this.pony.rotation.x = 0.7 + Math.min(0.5, speed * 0.06) + Math.sin(this.time * 3.6) * 0.08;
    // 눈 깜빡임
    this.blinkT -= dt;
    this.eyes.scale.y = this.blinkT < 0.1 ? 0.15 : 1;
    if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3;
    if (this.flashT > 0) {
      this.flashT -= dt;
      const on = this.flashT > 0;
      for (const m of this.mats) {
        if (on) {
          m.emissive.setRGB(1, 1, 1);
          m.emissiveIntensity = 1.3;
        } else {
          m.emissive.copy(m.userData.e as THREE.Color);
          m.emissiveIntensity = m.userData.ei as number;
        }
      }
    }
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const m of this.bladeMats) m.dispose();
    for (const m of this.basics) m.dispose();
  }
}

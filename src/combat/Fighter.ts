import * as THREE from 'three';
import type { AttackRunner } from './AttackRunner';
import { defaultMods, type Modifiers, type Segment, type Team, type Vitals } from './types';

export interface SwordSpec {
  length: number;
  shoulderHeight: number;
  /** 평소 검 자세 [수평각, 수직각] */
  rest: [number, number];
  /** 막기 자세 */
  guard: [number, number];
}

export interface FighterOptions {
  team: Team;
  name: string;
  /** 종류 키(예: 'recruit') */
  kind?: string;
  radius: number;
  height: number;
  sword: SwordSpec;
  hp: number;
  posture: number;
  stamina?: number;
  /** 자세 회복 시작까지 초 */
  postureRegenDelay: number;
  /** 초당 자세 회복량 */
  postureRegen: number;
}

const DEG = Math.PI / 180;

/**
 * 전투 참가자 공통 데이터. 플레이어와 적이 각자 하나씩 가진다.
 * 판정·피해 계산(combat)은 이 객체만 보고 동작한다.
 */
export class Fighter {
  private static nextId = 1;
  readonly id = Fighter.nextId++;
  readonly team: Team;
  readonly name: string;
  readonly kind: string;
  readonly radius: number;
  readonly height: number;
  readonly sword: SwordSpec;
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  yaw = 0;
  prevYaw = 0;
  alive = true;
  vitals: Vitals;
  attack: AttackRunner | null = null;
  /** 무적(구르기) */
  iframe = false;
  blocking = false;
  blockStartFrame = -9999;
  /** 강인함: 맞아도 경직 없음 */
  superArmor = false;
  /** 자세 붕괴 남은 프레임 */
  brokenFrames = 0;
  lastPostureHitFrame = -9999;
  postureRegenDelay: number;
  postureRegen: number;
  mods: Modifiers = defaultMods();
  stateName = 'idle';
  stateFrame = 0;
  /** 공격 중이 아닐 때 검 자세 */
  pose: [number, number];
  /** 공격 토큰 보유 여부(디버그 표시용) */
  hasToken = false;
  readonly seg: Segment = { a: new THREE.Vector3(), b: new THREE.Vector3() };
  readonly prevSeg: Segment = { a: new THREE.Vector3(), b: new THREE.Vector3() };
  private readonly hurtA = new THREE.Vector3();
  private readonly hurtB = new THREE.Vector3();

  constructor(o: FighterOptions) {
    this.team = o.team;
    this.name = o.name;
    this.kind = o.kind ?? o.team;
    this.radius = o.radius;
    this.height = o.height;
    this.sword = o.sword;
    this.pose = [...o.sword.rest];
    const st = o.stamina ?? 0;
    this.vitals = { hp: o.hp, maxHp: o.hp, posture: 0, maxPosture: o.posture, stamina: st, maxStamina: st, spirit: 0, maxSpirit: 0 };
    this.postureRegenDelay = o.postureRegenDelay;
    this.postureRegen = o.postureRegen;
  }

  /** 고정 단계 시작: 보간용 이전 값 저장 */
  beginTick(): void {
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.prevSeg.a.copy(this.seg.a);
    this.prevSeg.b.copy(this.seg.b);
  }

  /** 현재 자세로 검 선분을 다시 계산 */
  updateSword(): void {
    const [yawDeg, pitchDeg] = this.attack ? this.attack.pose() : this.pose;
    const yaw = this.yaw + yawDeg * DEG;
    const pitch = pitchDeg * DEG;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const bx = this.pos.x + fx * this.radius * 0.6;
    const by = this.pos.y + this.sword.shoulderHeight;
    const bz = this.pos.z + fz * this.radius * 0.6;
    const grip = 0.2;
    this.seg.a.set(bx + dx * grip, by + dy * grip, bz + dz * grip);
    const tip = grip + this.sword.length;
    this.seg.b.set(bx + dx * tip, by + dy * tip, bz + dz * tip);
  }

  /** 첫 등장 시 이전 값도 맞춰 둔다 */
  snap(): void {
    this.updateSword();
    this.beginTick();
  }

  /** 피격 판정 캡슐(몸통 1개) */
  hurtCapsule(): [THREE.Vector3, THREE.Vector3] {
    this.hurtA.set(this.pos.x, this.pos.y + this.radius, this.pos.z);
    this.hurtB.set(this.pos.x, this.pos.y + this.height - this.radius, this.pos.z);
    return [this.hurtA, this.hurtB];
  }

  isBroken(): boolean {
    return this.brokenFrames > 0;
  }

  setState(name: string): void {
    this.stateName = name;
    this.stateFrame = 0;
  }
}

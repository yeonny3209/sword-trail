import * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import { damp, turnTowards } from '../core/math';
import type { CharacterBody, Physics } from '../core/Physics';
import type { Input } from '../input/Input';
import { InputBuffer } from '../input/InputBuffer';
import { AttackRunner } from '../combat/AttackRunner';
import { Fighter, type SwordSpec } from '../combat/Fighter';
import { FighterView } from '../combat/FighterView';
import type { AttackData } from '../combat/types';
import { listenPlayerEvents } from './PlayerEvents';
import { updatePlayerState, type PlayerState } from './PlayerStates';

export interface PlayerData {
  radius: number;
  height: number;
  color: string;
  moveSpeed: number;
  lockMoveSpeed: number;
  acceleration: number;
  deceleration: number;
  turnSpeed: number;
  spawn: [number, number];
  sword: SwordSpec & { color: string };
  hp: number;
  posture: number;
  postureRegenDelay: number;
  postureRegen: number;
  stamina: { max: number; regenDelay: number; regenRate: number; blockRegenMul: number };
  dodge: { frames: number; distance: number; iframeStartFrame: number; iframeMs: number; stamina: number; cancelFrame: number };
  block: { moveSpeed: number };
  charge: { moveSpeed: number; pose: [number, number]; frames: number };
  hitstunFrames: number;
  blockstunFrames: number;
  knockback: number;
}

export interface SwordDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  light: string;
  heavy: string;
  skill: string;
  length: number;
  width: number;
  color: string;
  memory: string;
}

export interface PotionData { potionHeal: number; potionFrames: number; potionHealFrame: number; potionMoveSpeed: number }

/** 플레이어 본체: 입력 → 상태 기계 → 이동/공격. 상태별 동작은 PlayerStates.ts, 이벤트 반응은 PlayerEvents.ts */
export class Player {
  readonly data = getData<PlayerData>('player');
  readonly potion = getData<PotionData>('progression');
  light: AttackData[] = [];
  heavy!: AttackData;
  skill!: AttackData;
  skillCost = 50;
  readonly fighter: Fighter;
  readonly view: FighterView;
  readonly body: CharacterBody;
  readonly buffer: InputBuffer;
  readonly vel = new THREE.Vector2();
  input!: Input;
  camYaw = 0;
  frame = 0;
  state: PlayerState = 'idle';
  combo = 0;
  /** 마지막으로 스태미나를 쓴 프레임 */
  lastSpendFrame = -9999;
  /** 회피 방향 */
  readonly dodgeDir = new THREE.Vector2();
  /** 넉백 속도(피격·막기 시 밀림) */
  readonly push = new THREE.Vector2();
  stunFrames = 0;
  /** 적 고정 대상 */
  lockTarget: Fighter | null = null;
  potions = 0;

  constructor(scene: THREE.Scene, physics: Physics) {
    const d = this.data;
    this.fighter = new Fighter({
      team: 'player', name: '수련생', radius: d.radius, height: d.height, sword: { ...d.sword },
      hp: d.hp, posture: d.posture, stamina: d.stamina.max,
      postureRegenDelay: d.postureRegenDelay, postureRegen: d.postureRegen,
    });
    this.view = new FighterView(this.fighter, scene, { shape: 'capsule', color: d.color, swordColor: d.sword.color });
    this.body = physics.createCharacter(d.radius, d.height, d.spawn[0], d.spawn[1]);
    this.fighter.pos.set(d.spawn[0], 0, d.spawn[1]);
    this.fighter.snap();
    const bufferMs = getData<{ bufferMs: number }>('input').bufferMs;
    this.buffer = new InputBuffer(Math.round((bufferMs / 1000) * 60));
    this.equip('trainee');
    bus.emit('fighterSpawned', { fighter: this.fighter });
    listenPlayerEvents(this);
  }

  get pos(): THREE.Vector3 {
    return this.fighter.pos;
  }

  /** 검 교체: 공격 세트(약·강·기술)와 검 길이를 바꾼다 */
  equip(id: string): void {
    const sw = getData<{ list: SwordDef[] }>('swords').list.find((s) => s.id === id);
    if (!sw) return;
    this.light = getData<{ hits: AttackData[] }>(sw.light).hits;
    this.heavy = getData<{ attack: AttackData }>(sw.heavy).attack;
    const skill = getData<{ attack: AttackData; spirit: number }>(sw.skill);
    this.skill = skill.attack;
    this.skillCost = skill.spirit;
    this.fighter.sword.length = sw.length;
    this.view.sword.scale.x = this.view.sword.scale.z = sw.width;
    this.view.swordMat.color.set(sw.color);
  }

  knockFrom(from: THREE.Vector3, strength: number): void {
    const dx = this.fighter.pos.x - from.x, dz = this.fighter.pos.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    this.push.set((dx / len) * strength * 10, (dz / len) * strength * 10);
  }

  /** 완전 회복(새 런, 야영지 귀환) */
  reset(): void {
    const f = this.fighter;
    this.interrupt();
    f.alive = true;
    f.brokenFrames = 0;
    const v = f.vitals;
    v.hp = v.maxHp;
    v.stamina = v.maxStamina;
    v.posture = 0;
    v.spirit = 0;
    this.stunFrames = 0;
    this.setState('idle');
  }

  /** 진행 중인 행동을 끊는다 */
  interrupt(): void {
    const f = this.fighter;
    f.attack = null;
    f.blocking = false;
    f.iframe = false;
    f.superArmor = false;
    f.pose = [...this.data.sword.rest];
    this.vel.set(0, 0);
    this.buffer.clear();
  }

  /** 스태미나가 조금이라도 있으면 행동 가능(소울라이크 방식) */
  canSpend(): boolean {
    return this.fighter.vitals.stamina > 0;
  }

  spend(cost: number): void {
    const v = this.fighter.vitals;
    v.stamina = Math.max(0, v.stamina - cost);
    this.lastSpendFrame = this.frame;
  }

  private regenStamina(dt: number): void {
    const s = this.data.stamina;
    const v = this.fighter.vitals;
    const busy = this.state === 'attack' || this.state === 'dodge' || this.state === 'charge';
    if (busy || this.frame - this.lastSpendFrame < s.regenDelay * 60) return;
    const mul = (this.fighter.blocking ? s.blockRegenMul : 1) * this.fighter.mods.staminaRegenMul;
    v.stamina = Math.min(v.maxStamina, v.stamina + s.regenRate * mul * dt);
  }

  update(dt: number, frame: number, input: Input, camYaw: number): void {
    this.frame = frame;
    this.input = input;
    this.camYaw = camYaw;
    const f = this.fighter;
    f.beginTick();
    f.stateFrame++;
    for (const a of input.pressed) this.buffer.push(a, frame);
    if (input.pressed.has('interact')) bus.emit('interactPressed', {});
    if (this.lockTarget && !this.lockTarget.alive) this.lockTarget = null;
    updatePlayerState(this, dt);
    // 강인함: 기술 자체의 강인함 또는 각인(굳센 차지)
    const atk = f.attack?.data;
    f.superArmor = !!atk?.superArmor || (f.mods.heavyArmor && (this.state === 'charge' || !!atk?.heavy));
    this.applyPush(dt);
    this.regenStamina(dt);
    f.updateSword();
  }

  setState(s: PlayerState): void {
    this.state = s;
    this.fighter.setState(s);
  }

  /** 카메라 기준 입력 방향(월드). 입력 없으면 null */
  wishDir(): { x: number; z: number } | null {
    const axis = this.input.moveAxis();
    if (axis.x === 0 && axis.y === 0) return null;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    return { x: fx * axis.y - fz * axis.x, z: fz * axis.y + fx * axis.x };
  }

  /** 바라봐야 할 방향: 고정 대상 > 입력 방향 */
  faceTargetYaw(): number | null {
    const t = this.lockTarget;
    if (t) return Math.atan2(t.pos.x - this.fighter.pos.x, t.pos.z - this.fighter.pos.z);
    const w = this.wishDir();
    return w ? Math.atan2(w.x, w.z) : null;
  }

  /** 자유 이동(가감속 + 회전). 고정 중에는 대상을 보며 옆걸음 */
  locomotion(dt: number, speed: number, turn = true): void {
    const d = this.data;
    const w = this.wishDir();
    if (this.lockTarget) speed = Math.min(speed, d.lockMoveSpeed);
    const wantX = w ? w.x * speed : 0;
    const wantZ = w ? w.z * speed : 0;
    const k = damp((w ? d.acceleration : d.deceleration) / d.moveSpeed, dt);
    this.vel.x += (wantX - this.vel.x) * k;
    this.vel.y += (wantZ - this.vel.y) * k;
    if (turn) {
      const target = this.lockTarget ? this.faceTargetYaw() : w ? Math.atan2(w.x, w.z) : null;
      if (target !== null) this.fighter.yaw = turnTowards(this.fighter.yaw, target, d.turnSpeed * dt);
    }
    this.move(this.vel.x * dt, this.vel.y * dt, dt);
  }

  private applyPush(dt: number): void {
    if (this.push.lengthSq() < 0.01) return;
    this.move(this.push.x * dt, this.push.y * dt, dt);
    this.push.multiplyScalar(Math.exp(-14 * dt));
  }

  move(dx: number, dz: number, dt: number): void {
    this.body.move(dx, dz, dt);
    this.fighter.pos.set(this.body.x, this.body.y, this.body.z);
  }

  /** 바라보는 방향으로 dist만큼 이동 */
  advance(dist: number, dt: number): void {
    const y = this.fighter.yaw;
    this.move(Math.sin(y) * dist, Math.cos(y) * dist, dt);
  }

  startAttack(data: AttackData): void {
    this.spend(data.stamina ?? 0);
    const f = this.fighter;
    f.blocking = false;
    f.pose = [...this.data.sword.rest];
    this.vel.set(0, 0);
    // 공격 시작 시 고정 대상 또는 입력 방향으로 즉시 돌아선다
    const yaw = this.faceTargetYaw();
    if (yaw !== null) f.yaw = yaw;
    f.attack = new AttackRunner(f, data, f.mods.attackSpeed);
    bus.emit('attackStarted', { fighter: f, attack: data });
  }

  /** 기술 공격의 투사체(검기·충격파) */
  fireProjectile(data: AttackData): void {
    const p = data.projectile;
    if (!p) return;
    const f = this.fighter;
    const dx = Math.sin(f.yaw), dz = Math.cos(f.yaw);
    bus.emit('fireProjectile', {
      owner: f, attack: data, spec: p,
      x: f.pos.x + dx * (f.radius + 0.6), y: f.pos.y + p.height, z: f.pos.z + dz * (f.radius + 0.6), dx, dy: 0, dz,
    });
  }

  render(alpha: number, realDt: number): void {
    this.view.render(alpha, realDt);
    // 구르기: 몸통을 앞으로 한 바퀴
    const body = this.view.body;
    if (this.state === 'dodge') {
      const t = Math.min(1, (this.fighter.stateFrame + alpha) / this.data.dodge.frames);
      body.rotation.x = t * Math.PI * 2;
      body.position.y = this.data.height / 2 - Math.sin(t * Math.PI) * 0.45;
    } else {
      body.rotation.x = this.state === 'broken' ? -0.35 : this.state === 'dead' ? -1.4 : this.state === 'heal' ? 0.25 : 0;
      body.position.y = this.state === 'dead' ? this.data.radius : this.data.height / 2;
    }
  }
}

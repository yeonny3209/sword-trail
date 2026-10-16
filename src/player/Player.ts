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
}

/** 플레이어 본체: 입력 → 상태 기계 → 이동/공격. 상태별 동작은 PlayerStates.ts */
export class Player {
  readonly data = getData<PlayerData>('player');
  readonly light = getData<{ hits: AttackData[] }>('attacks/light').hits;
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

  constructor(scene: THREE.Scene, physics: Physics) {
    const d = this.data;
    this.fighter = new Fighter({
      team: 'player', name: '수련생', radius: d.radius, height: d.height, sword: d.sword,
      hp: d.hp, posture: d.posture, postureRegenDelay: d.postureRegenDelay, postureRegen: d.postureRegen,
    });
    this.view = new FighterView(this.fighter, scene, { shape: 'capsule', color: d.color, swordColor: d.sword.color });
    this.body = physics.createCharacter(d.radius, d.height, d.spawn[0], d.spawn[1]);
    this.fighter.pos.set(d.spawn[0], 0, d.spawn[1]);
    this.fighter.snap();
    const bufferMs = getData<{ bufferMs: number }>('input').bufferMs;
    this.buffer = new InputBuffer(Math.round((bufferMs / 1000) * 60));
    bus.emit('fighterSpawned', { fighter: this.fighter });
  }

  get pos(): THREE.Vector3 {
    return this.fighter.pos;
  }

  update(dt: number, frame: number, input: Input, camYaw: number): void {
    this.frame = frame;
    this.input = input;
    this.camYaw = camYaw;
    const f = this.fighter;
    f.beginTick();
    f.stateFrame++;
    for (const a of input.pressed) this.buffer.push(a, frame);
    updatePlayerState(this, dt);
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

  /** 자유 이동(가감속 + 이동 방향으로 회전) */
  locomotion(dt: number, speed: number, turn = true): void {
    const d = this.data;
    const w = this.wishDir();
    const wantX = w ? w.x * speed : 0;
    const wantZ = w ? w.z * speed : 0;
    const k = damp((w ? d.acceleration : d.deceleration) / d.moveSpeed, dt);
    this.vel.x += (wantX - this.vel.x) * k;
    this.vel.y += (wantZ - this.vel.y) * k;
    if (w && turn) this.fighter.yaw = turnTowards(this.fighter.yaw, Math.atan2(w.x, w.z), d.turnSpeed * dt);
    this.move(this.vel.x * dt, this.vel.y * dt, dt);
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

  /** 공격 시작 시 입력 방향으로 즉시 돌아선다 */
  faceWish(): void {
    const w = this.wishDir();
    if (w) this.fighter.yaw = Math.atan2(w.x, w.z);
  }

  startAttack(data: AttackData): void {
    this.vel.set(0, 0);
    this.faceWish();
    this.fighter.attack = new AttackRunner(this.fighter, data, this.fighter.mods.attackSpeed);
    bus.emit('attackStarted', { fighter: this.fighter, attack: data });
  }

  render(alpha: number, realDt: number): void {
    this.view.render(alpha, realDt);
  }
}

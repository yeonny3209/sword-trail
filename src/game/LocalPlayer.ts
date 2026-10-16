import * as THREE from 'three';
import { getData } from '../core/config';
import { damp, turnTowards } from '../core/math';
import { resolveCircle } from '../../shared/geom';
import { CLASS_BY_ID } from '../../shared/data';
import { MoveState, type SelfState } from '../../shared/protocol';
import type { ZoneDef } from '../../shared/types';
import type { Input } from '../input/Input';
import { CharacterModel } from './CharacterModel';

interface PlayerTuning { radius: number; acceleration: number; dashMul: number; jumpVelocity: number; gravity: number; turnSpeed: number }

/**
 * 내 캐릭터: 화면 기준 WASD 이동, 같은 방향 두 번 = 달리기, 스페이스 = 점프.
 * 위치는 내가 정하고 서버가 검사한다(보정이 오면 따른다).
 */
export class LocalPlayer {
  readonly t = getData<{ player: PlayerTuning }>('client').player;
  readonly model: CharacterModel;
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector2();
  vy = 0;
  yaw = 0;
  prevYaw = 0;
  dashing = false;
  /** 행동 중(공격 등)이면 이동 입력을 막는다 — 전투 단계에서 쓴다 */
  locked = false;
  speed: number;
  state: MoveState = MoveState.Idle;

  constructor(readonly self: SelfState) {
    const c = CLASS_BY_ID[self.cls];
    this.speed = c.base.speed;
    this.model = new CharacterModel({ body: c.color, weapon: c.weapon });
    this.place(self.x, self.z);
  }

  place(x: number, z: number): void {
    this.pos.set(x, 0, z);
    this.prev.copy(this.pos);
    this.vel.set(0, 0);
    this.vy = 0;
  }

  get air(): boolean {
    return this.pos.y > 0.001 || this.vy > 0;
  }

  update(dt: number, input: Input, zone: ZoneDef): void {
    this.prev.copy(this.pos);
    this.prevYaw = this.yaw;
    const axis = input.moveAxis();
    const moving = !this.locked && (axis.x !== 0 || axis.y !== 0);
    if (input.pressed.has('dash')) this.dashing = true;
    if (!moving) this.dashing = false;
    // 화면 위 = -Z
    const spd = this.speed * (this.dashing ? this.t.dashMul : 1);
    const wantX = moving ? axis.x * spd : 0;
    const wantZ = moving ? -axis.y * spd : 0;
    const k = damp(this.air ? this.t.acceleration * 0.03 : this.t.acceleration / spd, dt);
    this.vel.x += (wantX - this.vel.x) * k;
    this.vel.y += (wantZ - this.vel.y) * k;
    if (moving) this.yaw = turnTowards(this.yaw, Math.atan2(wantX, wantZ), this.t.turnSpeed * dt);

    if (!this.locked && !this.air && input.pressed.has('jump')) this.vy = this.t.jumpVelocity;
    this.vy -= this.t.gravity * dt;
    this.pos.y = Math.max(0, this.pos.y + this.vy * dt);
    if (this.pos.y === 0 && this.vy < 0) this.vy = 0;

    const [x, z] = resolveCircle(this.pos.x + this.vel.x * dt, this.pos.z + this.vel.y * dt, this.t.radius, zone.walls, zone.size);
    this.pos.x = x;
    this.pos.z = z;
    const h = Math.hypot(this.vel.x, this.vel.y);
    this.state = this.air ? MoveState.Air : h > 0.5 ? (this.dashing ? MoveState.Dash : MoveState.Run) : MoveState.Idle;
  }

  render(alpha: number, dt: number): void {
    const r = this.model.root;
    r.position.lerpVectors(this.prev, this.pos, alpha);
    let d = this.yaw - this.prevYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    r.rotation.y = this.prevYaw + d * alpha;
    this.model.animate(dt, Math.hypot(this.vel.x, this.vel.y), this.pos.y > 0.05);
  }
}

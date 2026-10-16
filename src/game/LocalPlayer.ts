import * as THREE from 'three';
import { getData } from '../core/config';
import { damp, turnTowards } from '../core/math';
import { applyReaction, disabled, newBody, stepBody, type Body } from '../../shared/combat';
import { resolveCircle } from '../../shared/geom';
import { ACTIONS, CLASS_BY_ID, KITS } from '../../shared/data';
import { MoveState, type SelfState } from '../../shared/protocol';
import type { ActionDef, ClassKit, HitDef, ZoneDef } from '../../shared/types';
import type { Action, Input } from '../input/Input';
import { CharacterModel } from './CharacterModel';
import { ActionRunner } from './combat/ActionRunner';

interface PlayerTuning { radius: number; acceleration: number; dashMul: number; jumpVelocity: number; gravity: number; turnSpeed: number; bufferFrames: number }

export type PState = 'free' | 'action' | 'hurt' | 'dead';

const SKILL_KEYS: Action[] = ['s1', 's2', 's3', 's4', 's5', 's6'];
const BUFFERED: Action[] = ['attack', 'back', 'jump', ...SKILL_KEYS];

/**
 * 내 캐릭터: 이동(화면 기준 WASD, 두 번 = 달리기, 스페이스 = 점프)과 행동(콤보·대시공격·점프공격·백스텝·스킬).
 * 위치는 내가 정하고 서버가 검사한다. 맞으면 공용 반응 물리로 밀리고 뜬다.
 */
export class LocalPlayer {
  readonly t = getData<{ player: PlayerTuning }>('client').player;
  readonly model: CharacterModel;
  readonly kit: ClassKit;
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector2();
  vy = 0;
  yaw = 0;
  prevYaw = 0;
  /** 마우스가 가리키는 방향(공격 방향) */
  aimYaw = 0;
  dashing = false;
  pstate: PState = 'free';
  action: ActionRunner | null = null;
  body: Body = newBody(0, 0);
  /** 스킬 쿨타임 끝나는 시각(ms) */
  readonly cds = new Map<string, number>();
  private buffer: { a: Action; left: number }[] = [];
  state: MoveState = MoveState.Idle;
  /** 행동을 시작할 때 서버에 알리기 */
  onAction: (def: ActionDef, instance: number) => void = () => {};
  /** 행동의 매 프레임(판정·연출) */
  onFrame: (run: ActionRunner) => void = () => {};

  constructor(public self: SelfState) {
    const c = CLASS_BY_ID[self.cls];
    this.kit = KITS[self.cls];
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

  /** 무적(백스텝·일어나기 직후) */
  invulnerable(): boolean {
    return this.pstate === 'dead' || !!this.action?.invul() || (this.pstate === 'hurt' && this.body.getup > 0) || this.body.getup > 0;
  }

  skillReady(def: ActionDef): boolean {
    return (def.lv ?? 1) <= this.self.lv && this.self.mp >= (def.mp ?? 0) && performance.now() >= (this.cds.get(def.id) ?? 0);
  }

  private take(...acts: Action[]): Action | null {
    const i = this.buffer.findIndex((b) => acts.includes(b.a));
    if (i < 0) return null;
    return this.buffer.splice(i, 1)[0].a;
  }

  update(dt: number, input: Input, zone: ZoneDef): void {
    this.prev.copy(this.pos);
    this.prevYaw = this.yaw;
    for (const a of input.pressed) if (BUFFERED.includes(a)) this.buffer.push({ a, left: this.t.bufferFrames });
    this.buffer = this.buffer.filter((b) => --b.left > 0);
    if (input.pressed.has('dash')) this.dashing = true;

    switch (this.pstate) {
      case 'dead':
        break;
      case 'hurt':
        this.updateHurt(dt, zone);
        break;
      case 'action':
        this.updateAction(dt, input, zone);
        break;
      case 'free':
        if (!this.tryStart(input)) this.updateFree(dt, input, zone);
        break;
    }
    const h = Math.hypot(this.vel.x, this.vel.y);
    this.state = this.pstate === 'dead' ? MoveState.Dead
      : this.pstate === 'hurt' ? (this.body.down > 0 ? MoveState.Down : this.body.air ? MoveState.Air : MoveState.Hit)
      : this.pstate === 'action' ? MoveState.Act
      : this.air ? MoveState.Air : h > 0.5 ? (this.dashing ? MoveState.Dash : MoveState.Run) : MoveState.Idle;
  }

  /** 자유 상태에서 입력으로 행동 시작 */
  private tryStart(input: Input): boolean {
    if (this.take('back')) return this.start(ACTIONS[this.kit.back]), true;
    for (let i = 0; i < SKILL_KEYS.length; i++) {
      const id = this.kit.skills[i];
      if (!id || !this.buffer.some((b) => b.a === SKILL_KEYS[i])) continue;
      const def = ACTIONS[id];
      if (!this.skillReady(def)) continue;
      this.take(SKILL_KEYS[i]);
      return this.start(def), true;
    }
    if (this.take('attack') || input.isDown('attack')) {
      const moving = input.moveAxis().x !== 0 || input.moveAxis().y !== 0;
      const id = this.air ? this.kit.jump : this.dashing && moving ? this.kit.dash : this.kit.combo;
      return this.start(ACTIONS[id]), true;
    }
    return false;
  }

  start(def: ActionDef): void {
    this.action = new ActionRunner(def);
    this.pstate = 'action';
    if (!def.back) this.yaw = this.aimYaw;
    if (!def.air) this.vel.set(0, 0);
    if (def.mp || def.cd) {
      this.cds.set(def.id, performance.now() + (def.cd ?? 0) * 1000);
      this.self.mp -= def.mp ?? 0;
    }
    this.dashing = false;
    this.onAction(def, this.action.instance);
  }

  private updateFree(dt: number, input: Input, zone: ZoneDef): void {
    const axis = input.moveAxis();
    const moving = axis.x !== 0 || axis.y !== 0;
    if (!moving) this.dashing = false;
    const spd = this.self.speed * (this.dashing ? this.t.dashMul : 1);
    const wantX = moving ? axis.x * spd : 0;
    const wantZ = moving ? -axis.y * spd : 0;
    const k = damp(this.air ? 2 : this.t.acceleration / spd, dt);
    this.vel.x += (wantX - this.vel.x) * k;
    this.vel.y += (wantZ - this.vel.y) * k;
    if (moving) this.yaw = turnTowards(this.yaw, Math.atan2(wantX, wantZ), this.t.turnSpeed * dt);
    if (!this.air && this.take('jump')) this.vy = this.t.jumpVelocity;
    this.fall(dt);
    this.moveBy(this.vel.x * dt, this.vel.y * dt, zone);
  }

  private fall(dt: number): void {
    this.vy -= this.t.gravity * dt;
    this.pos.y = Math.max(0, this.pos.y + this.vy * dt);
    if (this.pos.y === 0 && this.vy < 0) this.vy = 0;
  }

  private moveBy(dx: number, dz: number, zone: ZoneDef): void {
    const [x, z] = resolveCircle(this.pos.x + dx, this.pos.z + dz, this.t.radius, zone.walls, zone.size);
    this.pos.x = x;
    this.pos.z = z;
  }

  private updateAction(dt: number, input: Input, zone: ZoneDef): void {
    const a = this.action!;
    const def = a.def;
    const vy = a.vyNow();
    if (vy !== null) this.vy = vy;
    const wasAir = this.air;
    this.fall(dt);
    const sp = a.moveSpeed();
    if (sp) this.moveBy(Math.sin(this.yaw) * sp * dt, Math.cos(this.yaw) * sp * dt, zone);
    else if (def.air) this.moveBy(this.vel.x * dt, this.vel.y * dt, zone);
    // 점프 공격은 땅에 닿으면 끝
    if (def.air && wasAir && !this.air) return this.end();
    if (a.canCancel()) {
      if (this.take('back')) return this.start(ACTIONS[this.kit.back]);
      for (let i = 0; i < SKILL_KEYS.length; i++) {
        const id = this.kit.skills[i];
        if (!id || id === def.id || !this.buffer.some((b) => b.a === SKILL_KEYS[i])) continue;
        const sd = ACTIONS[id];
        if (!this.skillReady(sd)) continue;
        this.take(SKILL_KEYS[i]);
        return this.start(sd);
      }
    }
    if (a.canChain() && def.next && (this.take('attack') || input.isDown('attack'))) {
      const next = ACTIONS[def.next];
      if (!next.air || this.air) return this.start(next);
    }
    const axis = input.moveAxis();
    if (a.canMoveCancel() && (axis.x !== 0 || axis.y !== 0)) return this.end();
    this.onFrame(a);
    a.frame++;
    if (a.done()) this.end();
  }

  private end(): void {
    this.action = null;
    this.pstate = 'free';
  }

  /** 몬스터에게 맞았다(내가 판정). 강인함 중이면 밀리기만 한다 */
  hurt(hit: HitDef, fromX: number, fromZ: number, zone: ZoneDef): void {
    const armored = !!this.action?.armor();
    if (armored) {
      applyReaction(this.body, hit, this.pos.x - fromX, this.pos.z - fromZ, 1, true);
      return;
    }
    this.action = null;
    this.body = newBody(this.pos.x, this.pos.z);
    this.body.y = this.pos.y;
    if (this.pos.y > 0.05) this.body.air = true;
    applyReaction(this.body, hit, this.pos.x - fromX, this.pos.z - fromZ, 1);
    this.pstate = 'hurt';
    this.vel.set(0, 0);
    this.vy = 0;
    void zone;
  }

  private updateHurt(dt: number, zone: ZoneDef): void {
    const b = this.body;
    stepBody(b, dt, zone.walls, zone.size, this.t.radius);
    this.pos.set(b.x, b.y, b.z);
    if (!disabled(b)) this.pstate = 'free';
  }

  die(): void {
    this.pstate = 'dead';
    this.action = null;
    this.vel.set(0, 0);
  }

  revive(x: number, z: number): void {
    this.place(x, z);
    this.pstate = 'free';
    this.body = newBody(x, z);
    this.body.getup = 1.5;
  }

  render(alpha: number, dt: number): void {
    const r = this.model.root;
    r.position.lerpVectors(this.prev, this.pos, alpha);
    let d = this.yaw - this.prevYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    r.rotation.y = this.prevYaw + d * alpha;
    const m = this.model;
    if (this.action) {
      m.pose = this.action.pose(this.action.frame + alpha);
    } else {
      m.pose = [-30, -50];
    }
    m.applyPose();
    const down = this.pstate === 'dead' ? 1 : this.pstate === 'hurt' ? (this.body.down > 0 ? 1 : this.body.air ? 0.4 : 0) : 0;
    m.animate(dt, this.pstate === 'free' ? Math.hypot(this.vel.x, this.vel.y) : 0, this.pos.y > 0.05, down);
    this.body.getup = Math.max(0, this.body.getup - (this.pstate === 'hurt' ? 0 : dt));
  }
}

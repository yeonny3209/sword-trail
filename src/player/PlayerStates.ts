import { bus } from '../core/bus';
import { wrapAngle } from '../core/math';
import type { Player } from './Player';

export type PlayerState = 'idle' | 'attack' | 'charge' | 'dodge' | 'block' | 'heal' | 'hitstun' | 'broken' | 'dead';

/** 플레이어 상태 기계 한 프레임 */
export function updatePlayerState(p: Player, dt: number): void {
  switch (p.state) {
    case 'idle': return idle(p, dt);
    case 'attack': return attack(p, dt);
    case 'charge': return charge(p, dt);
    case 'dodge': return dodge(p, dt);
    case 'block': return block(p, dt);
    case 'heal': return heal(p, dt);
    case 'hitstun': return hitstun(p);
    case 'broken': return broken(p);
    case 'dead': return;
  }
}

/** 대기 상태와 캔슬 구간에서 공통으로 받는 행동 */
function tryActions(p: Player): boolean {
  const b = p.buffer;
  if (p.canSpend() && b.consume(['dodge'], p.frame)) {
    startDodge(p);
    return true;
  }
  if (p.input.isDown('block')) {
    startBlock(p);
    return true;
  }
  if (b.peek(['skill'], p.frame) && p.fighter.vitals.spirit >= p.skillCost) {
    b.consume(['skill'], p.frame);
    startSkill(p);
    return true;
  }
  if (p.potions > 0 && b.consume(['heal'], p.frame)) {
    startHeal(p);
    return true;
  }
  if (p.canSpend() && b.consume(['heavy'], p.frame)) {
    startHeavy(p);
    return true;
  }
  if (p.canSpend() && b.consume(['attack'], p.frame)) {
    startLight(p, 0);
    return true;
  }
  if (p.input.charging() && p.canSpend()) {
    p.setState('charge');
    return true;
  }
  return false;
}

function startLight(p: Player, index: number): void {
  p.combo = index;
  p.startAttack(p.light[index]);
  p.setState('attack');
}

function startHeavy(p: Player): void {
  p.combo = 0;
  p.startAttack(p.heavy);
  p.setState('attack');
}

/** 검 고유 기술(Q): 기력을 쓴다 */
function startSkill(p: Player): void {
  p.combo = 0;
  p.interrupt();
  p.fighter.vitals.spirit -= p.skillCost;
  p.startAttack(p.skill);
  p.setState('attack');
}

/** 회복약(E): 사용 중 이동이 느려지고, 중간 프레임에 회복 */
function startHeal(p: Player): void {
  p.interrupt();
  p.setState('heal');
  bus.emit('potionUsed', {});
}

function heal(p: Player, dt: number): void {
  const f = p.fighter;
  const d = p.potion;
  if (f.stateFrame === d.potionHealFrame) {
    bus.emit('heal', { target: f, amount: f.vitals.maxHp * d.potionHeal });
    bus.emit('sfx', { key: 'heal' });
  }
  p.locomotion(dt, d.potionMoveSpeed);
  if (f.stateFrame >= d.potionFrames) p.setState('idle');
}

function idle(p: Player, dt: number): void {
  if (tryActions(p)) return;
  p.locomotion(dt, p.data.moveSpeed);
}

function attack(p: Player, dt: number): void {
  const f = p.fighter;
  const run = f.attack;
  if (!run) return p.setState('idle');
  p.advance(run.tick(), dt);
  f.iframe = run.inIframes();
  if (run.data.projectile && run.frame === run.data.startup && !run.hitList.has(-1)) {
    run.hitList.add(-1); // 투사체는 한 번만
    p.fireProjectile(run.data);
  }
  if (run.canCancel()) {
    const b = p.buffer;
    if (p.canSpend() && b.consume(['dodge'], p.frame)) return startDodge(p);
    if (p.canSpend() && b.consume(['heavy'], p.frame)) return startHeavy(p);
    const isLight = p.light.includes(run.data);
    if (isLight && p.combo + 1 < p.light.length && p.canSpend() && b.consume(['attack'], p.frame)) {
      return startLight(p, p.combo + 1);
    }
    if (p.input.isDown('block')) return startBlock(p);
  }
  if (run.done()) {
    f.attack = null;
    f.iframe = false;
    p.combo = 0;
    p.setState('idle');
    if (!tryActions(p)) p.locomotion(dt, p.data.moveSpeed);
  }
}

function charge(p: Player, dt: number): void {
  const f = p.fighter;
  f.pose = [...p.data.charge.pose];
  if (p.buffer.consume(['heavy'], p.frame)) return startHeavy(p);
  if (p.canSpend() && p.buffer.consume(['dodge'], p.frame)) return startDodge(p);
  if (!p.input.charging()) {
    // 차지 완료 전에 뗌 → 약공격
    f.pose = [...p.data.sword.rest];
    if (p.buffer.consume(['attack'], p.frame)) return startLight(p, 0);
    return p.setState('idle');
  }
  p.locomotion(dt, p.data.charge.moveSpeed);
}

function startDodge(p: Player): void {
  const f = p.fighter;
  p.interrupt();
  p.spend(Math.max(0, p.data.dodge.stamina + f.mods.dodgeCostDelta));
  const w = p.wishDir();
  if (w) {
    const len = Math.hypot(w.x, w.z);
    p.dodgeDir.set(w.x / len, w.z / len);
    f.yaw = Math.atan2(w.x, w.z);
  } else {
    // 입력이 없으면 뒤로 물러난다
    p.dodgeDir.set(-Math.sin(f.yaw), -Math.cos(f.yaw));
  }
  p.setState('dodge');
  bus.emit('dodgeStarted', { fighter: f });
}

function dodge(p: Player, dt: number): void {
  const f = p.fighter;
  const d = p.data.dodge;
  const fr = f.stateFrame;
  const iframeEnd = d.iframeStartFrame + Math.round((d.iframeMs / 1000) * 60);
  f.iframe = fr >= d.iframeStartFrame && fr < iframeEnd;
  // 처음에 빠르고 끝에 느려지는 이동
  const ease = (t: number) => 1 - (1 - t) * (1 - t);
  const t0 = Math.min(1, (fr - 1) / d.frames), t1 = Math.min(1, fr / d.frames);
  const dist = (ease(t1) - ease(t0)) * d.distance;
  p.move(p.dodgeDir.x * dist, p.dodgeDir.y * dist, dt);
  if (fr >= d.cancelFrame) {
    f.iframe = false;
    if (tryActions(p)) return;
  }
  if (fr >= d.frames) {
    f.iframe = false;
    p.setState('idle');
  }
}

function startBlock(p: Player): void {
  const f = p.fighter;
  f.attack = null;
  f.blocking = true;
  f.blockStartFrame = p.frame;
  f.pose = [...p.data.sword.guard];
  p.combo = 0;
  p.setState('block');
  bus.emit('blockStarted', { fighter: f });
}

function endBlock(p: Player): void {
  p.fighter.blocking = false;
  p.fighter.pose = [...p.data.sword.rest];
}

function block(p: Player, dt: number): void {
  const f = p.fighter;
  if (!p.input.isDown('block')) {
    endBlock(p);
    return p.setState('idle');
  }
  if (p.canSpend() && p.buffer.consume(['dodge'], p.frame)) return startDodge(p);
  if (p.canSpend() && p.buffer.consume(['attack'], p.frame)) {
    endBlock(p);
    return startLight(p, 0);
  }
  p.locomotion(dt, p.data.block.moveSpeed, false);
  // 막는 동안은 천천히 이동 방향으로 돈다(고정 중에는 대상 쪽)
  const target = p.faceTargetYaw();
  if (target !== null) f.yaw += wrapAngle(target - f.yaw) * Math.min(1, dt * 6);
}

function hitstun(p: Player): void {
  if (--p.stunFrames <= 0) p.setState('idle');
}

function broken(p: Player): void {
  if (!p.fighter.isBroken()) p.setState('idle');
}

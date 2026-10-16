import type { Player } from './Player';

export type PlayerState = 'idle' | 'attack';

/** 플레이어 상태 기계 한 프레임 */
export function updatePlayerState(p: Player, dt: number): void {
  switch (p.state) {
    case 'idle':
      return idle(p, dt);
    case 'attack':
      return attack(p, dt);
  }
}

function idle(p: Player, dt: number): void {
  if (p.buffer.consume(['attack'], p.frame)) {
    p.combo = 0;
    p.startAttack(p.light[0]);
    p.setState('attack');
    return;
  }
  p.locomotion(dt, p.data.moveSpeed);
}

function attack(p: Player, dt: number): void {
  const f = p.fighter;
  const run = f.attack;
  if (!run) {
    p.setState('idle');
    return;
  }
  p.advance(run.tick(), dt);
  if (run.canCancel()) {
    if (p.combo + 1 < p.light.length && p.buffer.consume(['attack'], p.frame)) {
      p.combo++;
      p.startAttack(p.light[p.combo]);
      return;
    }
  }
  if (run.done()) {
    f.attack = null;
    p.combo = 0;
    p.setState('idle');
    p.locomotion(dt, p.data.moveSpeed);
  }
}

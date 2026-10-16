import { bus } from '../core/bus';
import { getData } from '../core/config';
import { wrapAngle, yawTo } from '../core/math';
import type { Fighter } from '../combat/Fighter';
import type { CameraData } from './CameraRig';

/**
 * 적 고정 시점(마우스 휠 클릭). 고정 중에는 마우스를 좌우로 빠르게 튕겨 대상을 바꾼다.
 */
export class LockOn {
  target: Fighter | null = null;
  private readonly d = getData<{ camera: CameraData }>('player').camera;
  private readonly enemies: Fighter[] = [];
  private flickAcc = 0;
  private flickTime = 0;
  private flickCooldown = 0;

  constructor() {
    bus.on('fighterSpawned', ({ fighter }) => {
      if (fighter.team === 'enemy') this.enemies.push(fighter);
    });
    bus.on('fighterRemoved', ({ fighter }) => {
      const i = this.enemies.indexOf(fighter);
      if (i >= 0) this.enemies.splice(i, 1);
      if (this.target === fighter) this.set(null);
    });
  }

  private set(t: Fighter | null): void {
    if (this.target === t) return;
    this.target = t;
    bus.emit('lockChanged', { target: t });
  }

  /** 고정 단계마다: 토글 처리와 대상 유효성 검사 */
  update(togglePressed: boolean, player: Fighter, camYaw: number): void {
    if (togglePressed) {
      this.set(this.target ? null : this.pick(player, camYaw, null));
      return;
    }
    const t = this.target;
    if (t && !t.alive) this.set(this.pick(player, camYaw, t));
    else if (t && this.dist(player, t) > this.d.lockMaxRange * 1.4) this.set(null);
    if (!player.alive && this.target) this.set(null);
  }

  /** 렌더 프레임마다: 마우스 수평 이동량으로 대상 전환 */
  flick(dx: number, player: Fighter, camYaw: number, realDt: number): void {
    if (!this.target) return;
    this.flickCooldown -= realDt;
    this.flickTime += realDt;
    if (this.flickTime > 0.15) {
      this.flickTime = 0;
      this.flickAcc = 0;
    }
    this.flickAcc += dx;
    if (this.flickCooldown > 0 || Math.abs(this.flickAcc) < this.d.lockSwitchFlick) return;
    const sign = Math.sign(this.flickAcc);
    this.flickAcc = 0;
    this.flickCooldown = 0.3;
    const cur = wrapAngle(yawTo(player.pos.x, player.pos.z, this.target.pos.x, this.target.pos.z) - camYaw);
    let best: Fighter | null = null;
    let bestDelta = Infinity;
    for (const e of this.enemies) {
      if (e === this.target || !e.alive || this.dist(player, e) > this.d.lockMaxRange) continue;
      const rel = wrapAngle(yawTo(player.pos.x, player.pos.z, e.pos.x, e.pos.z) - camYaw);
      // 화면 오른쪽 = 각도 감소
      const delta = (cur - rel) * sign;
      if (delta > 0 && delta < bestDelta) {
        bestDelta = delta;
        best = e;
      }
    }
    if (best) this.set(best);
  }

  private dist(a: Fighter, b: Fighter): number {
    return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  }

  /** 화면 중앙에 가깝고 가까운 적을 고른다 */
  private pick(player: Fighter, camYaw: number, exclude: Fighter | null): Fighter | null {
    let best: Fighter | null = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e === exclude) continue;
      const dist = this.dist(player, e);
      if (dist > this.d.lockMaxRange) continue;
      const ang = Math.abs(wrapAngle(yawTo(player.pos.x, player.pos.z, e.pos.x, e.pos.z) - camYaw));
      const score = ang * 2 + dist / this.d.lockMaxRange;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }
}

import type * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { Fighter } from './Fighter';
import type { AttackData, HitSource, Segment } from './types';

export type AttackPhase = 'startup' | 'active' | 'recovery' | 'done';

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * 공격 데이터 하나를 프레임 단위로 실행한다: 선딜 → 판정 → 후딜.
 * 검 자세(각도)와 전진 거리를 계산하고, 판정 구간이면 HitSource로 동작한다.
 */
export class AttackRunner implements HitSource {
  progress = 0;
  readonly hitList = new Set<number>();
  readonly radius: number;
  private activeAnnounced = false;

  constructor(
    readonly owner: Fighter,
    readonly data: AttackData,
    private readonly speed = 1,
  ) {
    this.radius = data.hitRadius ?? getData<{ hitRadius: number }>('combat').hitRadius;
  }

  get frame(): number {
    return Math.floor(this.progress);
  }

  get total(): number {
    return this.data.startup + this.data.active + this.data.recovery;
  }

  get prevSeg(): Segment {
    return this.owner.prevSeg;
  }

  get seg(): Segment {
    return this.owner.seg;
  }

  origin(): THREE.Vector3 {
    return this.owner.pos;
  }

  phase(): AttackPhase {
    const f = this.frame, d = this.data;
    if (f < d.startup) return 'startup';
    if (f < d.startup + d.active) return 'active';
    if (f < this.total) return 'recovery';
    return 'done';
  }

  isActive(): boolean {
    return this.phase() === 'active';
  }

  canCancel(): boolean {
    return this.frame >= this.data.cancelFrame;
  }

  done(): boolean {
    return this.frame >= this.total;
  }

  inIframes(): boolean {
    const r = this.data.iframes;
    return !!r && this.frame >= r[0] && this.frame < r[1];
  }

  /** 한 프레임 진행. 이번 프레임의 전진 거리(m)를 돌려준다. */
  tick(): number {
    const d = this.data;
    const moveFrames = d.startup + d.active;
    const before = this.progress;
    this.progress += this.speed;
    const moved = Math.max(0, Math.min(this.progress, moveFrames) - Math.min(before, moveFrames));
    if (!this.activeAnnounced && this.isActive()) {
      this.activeAnnounced = true;
      bus.emit('attackActive', { fighter: this.owner, attack: d });
    }
    return moveFrames > 0 ? (d.advance * moved) / moveFrames : 0;
  }

  /** 현재 검 자세 [수평각, 수직각] */
  pose(): [number, number] {
    const d = this.data;
    const rest = this.owner.pose;
    const f = this.progress;
    const [fy, fp] = d.arc.from;
    const [ty, tp] = d.arc.to;
    if (f < d.startup) {
      const t = easeOut(Math.min(1, (f + 1) / d.startup));
      return [rest[0] + (fy - rest[0]) * t, rest[1] + (fp - rest[1]) * t];
    }
    if (f < d.startup + d.active) {
      const t = Math.min(1, (f - d.startup + 1) / d.active);
      return [fy + (ty - fy) * t, fp + (tp - fp) * t];
    }
    const t = easeInOut(Math.min(1, (f - d.startup - d.active) / Math.max(1, d.recovery)));
    return [ty + (rest[0] - ty) * t, tp + (rest[1] - tp) * t];
  }
}

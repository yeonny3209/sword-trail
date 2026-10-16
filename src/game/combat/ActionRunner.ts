import type { ActionDef } from '../../../shared/types';

let nextInstance = 1;

/**
 * 행동 하나를 프레임 단위로 실행: 무기 자세, 판정 구간, 전진 속도, 점프, 연출 시점.
 * 내 캐릭터는 판정까지 쓰고, 다른 플레이어는 자세(애니메이션)만 쓴다.
 */
export class ActionRunner {
  frame = 0;
  readonly instance = nextInstance++;
  /** 판정별로 이미 맞힌 대상: `${판정번호}:${대상}` → 마지막으로 맞힌 프레임 */
  readonly hitLog = new Map<string, number>();

  constructor(readonly def: ActionDef) {}

  get len(): number {
    return this.def.len;
  }

  done(): boolean {
    return this.frame >= this.def.len;
  }

  canChain(): boolean {
    return this.def.chain !== undefined && this.frame >= this.def.chain;
  }

  canCancel(): boolean {
    return this.def.cancel !== undefined && this.frame >= this.def.cancel;
  }

  canMoveCancel(): boolean {
    return this.frame >= (this.def.moveCancel ?? this.def.len);
  }

  private inRange(r?: [number, number]): boolean {
    return !!r && this.frame >= r[0] && this.frame <= r[1];
  }

  invul(): boolean {
    return this.inRange(this.def.invul);
  }

  armor(): boolean {
    return this.inRange(this.def.armor);
  }

  trailOn(): boolean {
    return !!this.def.trail?.some((r) => this.frame >= r[0] && this.frame <= r[1]);
  }

  /** 지금 판정이 켜진 타격 번호들 */
  activeHits(): number[] {
    const out: number[] = [];
    this.def.hits.forEach((h, i) => {
      if (this.frame >= h.f[0] && this.frame <= h.f[1]) out.push(i);
    });
    return out;
  }

  /** 대상을 이 판정으로 지금 때릴 수 있나(연타 판정은 multi 프레임 간격) */
  canHit(hitIndex: number, target: string): boolean {
    const key = `${hitIndex}:${target}`;
    const last = this.hitLog.get(key);
    if (last === undefined) return true;
    const multi = this.def.hits[hitIndex].multi;
    return !!multi && this.frame - last >= multi;
  }

  markHit(hitIndex: number, target: string): void {
    this.hitLog.set(`${hitIndex}:${target}`, this.frame);
  }

  /** 이번 프레임의 앞으로 미는 속도(m/s) */
  moveSpeed(): number {
    for (const [a, b, v] of this.def.move ?? []) if (this.frame >= a && this.frame <= b) return v;
    return 0;
  }

  /** 정확히 이번 프레임에 일어나는 것들 */
  vyNow(): number | null {
    const e = this.def.vy?.find((v) => v[0] === this.frame);
    return e ? e[1] : null;
  }

  fxNow(): [string, number | undefined][] {
    return (this.def.fx ?? []).filter((e) => e[0] === this.frame).map((e) => [e[1], e[2]]);
  }

  sfxNow(): string[] {
    return (this.def.sfx ?? []).filter((e) => e[0] === this.frame).map((e) => e[1]);
  }

  /** 키프레임 사이를 보간한 무기 자세 [수평각, 수직각] */
  pose(frame = this.frame): [number, number] {
    const p = this.def.pose;
    if (frame <= p[0][0]) return [p[0][1], p[0][2]];
    for (let i = 1; i < p.length; i++) {
      if (frame <= p[i][0]) {
        const a = p[i - 1], b = p[i];
        const t = (frame - a[0]) / Math.max(1, b[0] - a[0]);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        return [a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
      }
    }
    const last = p[p.length - 1];
    return [last[1], last[2]];
  }
}

/** 서버 스냅샷 보간: 과거 시점(지금 - 지연)의 위치를 두 샘플 사이에서 계산한다 */
export interface Sample {
  t: number;
  x: number;
  z: number;
  y: number;
  f: number;
  st: number;
}

const MAX = 24;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class InterpBuffer {
  private samples: Sample[] = [];

  push(s: Sample): void {
    const last = this.samples[this.samples.length - 1];
    if (last && s.t <= last.t) return;
    this.samples.push(s);
    if (this.samples.length > MAX) this.samples.shift();
  }

  /** 순간이동(보정·리스폰) 후에는 과거 샘플을 버린다 */
  reset(s: Sample): void {
    this.samples = [s];
  }

  latest(): Sample | undefined {
    return this.samples[this.samples.length - 1];
  }

  sample(time: number, out: Sample): Sample | null {
    const s = this.samples;
    if (!s.length) return null;
    if (time <= s[0].t) return Object.assign(out, s[0]);
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1], b = s[i];
      if (time >= a.t && time <= b.t) {
        const k = (time - a.t) / Math.max(1, b.t - a.t);
        out.t = time;
        out.x = a.x + (b.x - a.x) * k;
        out.z = a.z + (b.z - a.z) * k;
        out.y = a.y + (b.y - a.y) * k;
        out.f = lerpAngle(a.f, b.f, k);
        out.st = k < 0.5 ? a.st : b.st;
        return out;
      }
    }
    return Object.assign(out, s[s.length - 1]);
  }
}

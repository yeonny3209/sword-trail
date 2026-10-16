import type { Rect } from './types';

/**
 * 원(캐릭터)을 사각형 벽과 존 경계 밖으로 밀어낸다. 바닥이 평평해서 2D로 충분하다.
 * 서버와 클라이언트가 같은 함수를 써서 위치가 어긋나지 않게 한다.
 */
export function resolveCircle(x: number, z: number, r: number, rects: readonly Rect[], size: readonly [number, number]): [number, number] {
  const hw = size[0] / 2 - r, hd = size[1] / 2 - r;
  x = Math.max(-hw, Math.min(hw, x));
  z = Math.max(-hd, Math.min(hd, z));
  for (let pass = 0; pass < 2; pass++) {
    for (const b of rects) {
      const minX = b.x - b.w / 2, maxX = b.x + b.w / 2, minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
      const cx = Math.max(minX, Math.min(maxX, x));
      const cz = Math.max(minZ, Math.min(maxZ, z));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // 중심이 사각형 안: 가장 얕은 쪽으로 밀어낸다
        const pen = [x - minX + r, maxX - x + r, z - minZ + r, maxZ - z + r];
        const i = pen.indexOf(Math.min(...pen));
        if (i === 0) x = minX - r;
        else if (i === 1) x = maxX + r;
        else if (i === 2) z = minZ - r;
        else z = maxZ + r;
      }
    }
  }
  return [x, z];
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

/** yaw(0 = +z)로의 방향 */
export function yawTo(fx: number, fz: number, tx: number, tz: number): number {
  return Math.atan2(tx - fx, tz - fz);
}

export function wrapAngle(a: number): number {
  const TAU = Math.PI * 2;
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** 히트 도형: 공격자 위치·방향 기준 */
export interface HitShape {
  /** arc: 부채꼴(반지름·각도), box: 앞쪽 직사각형(길이·폭), circle: 앞 offset 지점의 원 */
  type: 'arc' | 'box' | 'circle';
  range: number;
  /** arc: 전체 각도(도), box: 폭(m), circle: 사용 안 함 */
  width: number;
  /** circle 중심을 앞으로 얼마나 */
  offset?: number;
  /** 판정 높이(공중 대상) */
  height?: number;
}

/** 대상 원(반지름 tr)이 히트 도형에 닿는가 */
export function shapeHits(
  s: HitShape, ax: number, az: number, yaw: number,
  tx: number, tz: number, tr: number, ty = 0,
): boolean {
  if (ty > (s.height ?? 2.6)) return false;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const dx = tx - ax, dz = tz - az;
  const fwd = dx * fx + dz * fz;
  const side = dx * fz - dz * fx;
  if (s.type === 'box') {
    return fwd >= -tr && fwd <= s.range + tr && Math.abs(side) <= s.width / 2 + tr;
  }
  if (s.type === 'circle') {
    const cx = ax + fx * (s.offset ?? 0), cz = az + fz * (s.offset ?? 0);
    return dist2(cx, cz, tx, tz) <= (s.range + tr) * (s.range + tr);
  }
  const d = Math.hypot(dx, dz);
  if (d > s.range + tr) return false;
  if (d < tr + 0.3) return true;
  const half = (s.width / 2) * (Math.PI / 180);
  const ang = Math.abs(Math.atan2(side, fwd));
  // 원 크기만큼 각도 여유
  return ang <= half + Math.asin(Math.min(1, tr / d));
}

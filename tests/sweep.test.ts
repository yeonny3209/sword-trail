import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { segmentDistanceSq, sweepCapsule } from '../src/combat/sweep';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('segmentDistanceSq', () => {
  it('평행한 선분', () => {
    expect(segmentDistanceSq(v(0, 0, 0), v(1, 0, 0), v(0, 2, 0), v(1, 2, 0))).toBeCloseTo(4);
  });
  it('교차하는 선분은 0', () => {
    expect(segmentDistanceSq(v(-1, 0, 0), v(1, 0, 0), v(0, -1, 0), v(0, 1, 0))).toBeCloseTo(0);
  });
  it('끝점끼리 가장 가까움', () => {
    expect(segmentDistanceSq(v(0, 0, 0), v(1, 0, 0), v(3, 0, 0), v(4, 0, 0))).toBeCloseTo(4);
  });
});

describe('sweepCapsule', () => {
  const capA = v(0, 0.4, 2);
  const capB = v(0, 1.4, 2);
  it('한 프레임에 대상을 통과해도 적중', () => {
    // 이전 프레임: 대상 왼쪽, 현재: 대상 오른쪽 (둘 다 닿지 않음)
    const prev = { a: v(3, 1, 0.5), b: v(3, 1, 3.5) };
    const cur = { a: v(-3, 1, 0.5), b: v(-3, 1, 3.5) };
    expect(sweepCapsule(prev, cur, 0.1, capA, capB, 0.4)).toBe(true);
  });
  it('멀리 지나가면 빗나감', () => {
    const prev = { a: v(3, 1, 5), b: v(3, 1, 7) };
    const cur = { a: v(-3, 1, 5), b: v(-3, 1, 7) };
    expect(sweepCapsule(prev, cur, 0.1, capA, capB, 0.4)).toBe(false);
  });
});

import * as THREE from 'three';
import type { Segment } from './types';

const d1 = new THREE.Vector3();
const d2 = new THREE.Vector3();
const r = new THREE.Vector3();
const c1 = new THREE.Vector3();
const c2 = new THREE.Vector3();

/** 두 선분 사이 최단 거리의 제곱. 가장 가까운 점을 outA, outB에 담는다. */
export function segmentDistanceSq(
  p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3,
  outA?: THREE.Vector3, outB?: THREE.Vector3,
): number {
  d1.subVectors(q1, p1);
  d2.subVectors(q2, p2);
  r.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s: number, t: number;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  outA?.copy(c1);
  outB?.copy(c2);
  return c1.distanceToSquared(c2);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const sa = new THREE.Vector3();
const sb = new THREE.Vector3();
const pa = new THREE.Vector3();
const pb = new THREE.Vector3();

/**
 * 검 캡슐을 이전 프레임 위치에서 현재 위치까지 쓸어서(sweep) 대상 캡슐과 겹치는지 검사.
 * 빠른 휘두름이 프레임 사이에서 대상을 통과하는 문제를 막는다.
 * 닿으면 접촉점을 out에 담고 true.
 */
export function sweepCapsule(
  prev: Segment, cur: Segment, radius: number,
  capA: THREE.Vector3, capB: THREE.Vector3, capR: number,
  out?: THREE.Vector3,
): boolean {
  const move = Math.max(prev.a.distanceTo(cur.a), prev.b.distanceTo(cur.b));
  const steps = Math.min(12, Math.max(1, Math.ceil(move / Math.max(0.05, radius * 1.5))));
  const rr = (radius + capR) * (radius + capR);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    sa.lerpVectors(prev.a, cur.a, t);
    sb.lerpVectors(prev.b, cur.b, t);
    if (segmentDistanceSq(sa, sb, capA, capB, pa, pb) <= rr) {
      out?.lerpVectors(pa, pb, 0.5);
      return true;
    }
  }
  return false;
}

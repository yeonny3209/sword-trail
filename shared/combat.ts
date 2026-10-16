import { resolveCircle } from './geom';
import type { HitDef, Rect } from './types';

/** 띄워진 대상에 걸리는 중력(공중 콤보가 이어지도록 실제보다 약하게) */
export const JUGGLE_GRAVITY = 30;
/** 떨어진 뒤 누워 있는 시간(초) */
export const DOWN_TIME = 0.75;
/** 일어나면서 잠깐 무적(초) */
export const GETUP_INVUL = 0.4;

/** 맞고 날아가는 몸(몬스터, 또는 맞은 플레이어) */
export interface Body {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  /** 공중에 떠 있음(띄워짐) */
  air: boolean;
  /** 경직 남은 초 */
  stun: number;
  /** 다운 남은 초 */
  down: number;
  /** 일어난 직후 무적 남은 초 */
  getup: number;
  /** 공중 콤보 횟수(많을수록 덜 뜬다) */
  juggle: number;
}

export function newBody(x: number, z: number): Body {
  return { x, z, y: 0, vx: 0, vz: 0, vy: 0, air: false, stun: 0, down: 0, getup: 0, juggle: 0 };
}

/**
 * 맞았을 때 반응: 밀려나고, kz가 있으면 띄워지고, 공중이면 다시 띄운다.
 * 강인함(슈퍼아머)이면 살짝만 밀린다.
 */
export function applyReaction(b: Body, hit: HitDef, dirX: number, dirZ: number, weight: number, superArmor = false): void {
  const len = Math.hypot(dirX, dirZ) || 1;
  dirX /= len;
  dirZ /= len;
  if (superArmor) {
    b.vx += dirX * hit.kx * 0.15;
    b.vz += dirZ * hit.kx * 0.15;
    return;
  }
  const push = hit.pull ? -1 : 1;
  b.vx = dirX * (hit.kx / weight) * push;
  b.vz = dirZ * (hit.kx / weight) * push;
  if (b.air) {
    const decay = Math.max(0.3, 1 - b.juggle * 0.09);
    b.vy = Math.max(b.vy, ((hit.airKz ?? (hit.kz ? hit.kz * 0.55 : 2.6)) / weight) * decay);
    b.juggle++;
  } else if (hit.kz) {
    b.vy = hit.kz / weight;
    b.air = true;
    b.down = 0;
    b.juggle = 1;
  } else if (b.down > 0) {
    // 누운 대상은 살짝만 튕긴다
    b.vy = 1.6;
    b.air = true;
  }
  b.stun = Math.max(b.stun, hit.stun / 60);
}

/** 반응 물리 한 단계 */
export function stepBody(b: Body, dt: number, walls: readonly Rect[], size: readonly [number, number], radius: number): void {
  if (b.air || b.y > 0) {
    b.vy -= JUGGLE_GRAVITY * dt;
    b.y += b.vy * dt;
    if (b.y <= 0) {
      b.y = 0;
      b.vy = 0;
      if (b.air) {
        b.air = false;
        b.down = DOWN_TIME;
        b.juggle = 0;
      }
    }
  }
  const fr = Math.exp(-(b.air ? 1.2 : 9) * dt);
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.vx *= fr;
  b.vz *= fr;
  [b.x, b.z] = resolveCircle(b.x, b.z, radius, walls, size);
  if (!b.air) b.stun = Math.max(0, b.stun - dt);
  if (b.down > 0) {
    b.down = Math.max(0, b.down - dt);
    if (b.down === 0) b.getup = GETUP_INVUL;
  } else if (b.getup > 0) b.getup = Math.max(0, b.getup - dt);
}

/** 맞아서 아무것도 못 하는 상태인가 */
export function disabled(b: Body): boolean {
  return b.air || b.stun > 0 || b.down > 0;
}

export interface DamageOpts {
  crit: boolean;
  critMul: number;
  back: boolean;
  counter: boolean;
}

/** 피해 = 공격력 × 배율 × 흔들림(±7%) × 치명타·백어택·카운터 × 방어 감쇠 */
export function rollDamage(atk: number, mult: number, def: number, roll: number, o: DamageOpts): number {
  let d = atk * mult * (0.93 + roll * 0.14);
  if (o.crit) d *= o.critMul;
  if (o.back) d *= 1.1;
  if (o.counter) d *= 1.25;
  d *= 100 / (100 + Math.max(0, def));
  return Math.max(1, Math.round(d));
}

/** 공격자가 대상의 등 뒤에 있는가(대상이 바라보는 반대쪽) */
export function isBackAttack(targetYaw: number, fromX: number, fromZ: number, tx: number, tz: number): boolean {
  const fx = Math.sin(targetYaw), fz = Math.cos(targetYaw);
  return (fromX - tx) * fx + (fromZ - tz) * fz < 0;
}

/** 레벨 차이에 따른 경험치 배율(너무 낮은 몬스터는 적게) */
export function expFactor(playerLv: number, monsterLv: number): number {
  const d = monsterLv - playerLv;
  if (d >= 0) return Math.min(1.3, 1 + d * 0.06);
  return Math.max(0.1, 1 + d * 0.15);
}

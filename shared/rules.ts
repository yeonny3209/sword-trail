import { CLASS_BY_ID } from './data';
import type { ClassId } from './types';

/** 레벨·직업으로 정해지는 기본 능력치 */
export interface Stats {
  mhp: number;
  mmp: number;
  atk: number;
  def: number;
  crit: number;
  speed: number;
}

export function baseStats(cls: ClassId, lv: number): Stats {
  const c = CLASS_BY_ID[cls];
  const n = lv - 1;
  return {
    mhp: Math.round(c.base.hp + c.growth.hp * n),
    mmp: Math.round(c.base.mp + c.growth.mp * n),
    atk: Math.round(c.base.atk + c.growth.atk * n),
    def: Math.round(c.base.def + c.growth.def * n),
    crit: c.base.crit,
    speed: c.base.speed,
  };
}

/** 다음 레벨까지 필요한 경험치 */
export function expToNext(lv: number): number {
  return Math.round(60 * Math.pow(lv, 1.75) + 40 * lv);
}

export const MAX_LEVEL = 40;

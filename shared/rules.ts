import { CLASS_BY_ID } from './data';
import type { ActionDef, ClassId } from './types';

/** 레벨·직업·스탯으로 정해지는 능력치 */
export interface Stats {
  mhp: number;
  mmp: number;
  atk: number;
  def: number;
  crit: number;
  speed: number;
}

export interface Alloc {
  str: number;
  dex: number;
  vit: number;
  int: number;
}

export type StatKey = keyof Alloc;
export const STAT_KEYS: StatKey[] = ['str', 'dex', 'vit', 'int'];
export const STAT_NAMES: Record<StatKey, string> = { str: '힘', dex: '민첩', vit: '체력', int: '지능' };
export const STAT_DESC: Record<StatKey, string> = {
  str: '공격력이 오른다(검사·광검사는 더 많이)',
  dex: '치명타 확률과 공격력이 오른다(쌍검사는 더 많이)',
  vit: '최대 HP와 방어력이 오른다',
  int: '최대 MP와 공격력이 오른다(마검사는 더 많이)',
};
export const STAT_POINTS_PER_LEVEL = 4;
export const SKILL_POINTS_PER_LEVEL = 1;
export const MAX_LEVEL = 40;

export function emptyAlloc(): Alloc {
  return { str: 0, dex: 0, vit: 0, int: 0 };
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

/** 장비 등에서 더해지는 수치 */
export type Bonus = Partial<Stats>;

/** 최종 능력치: 기본 + 스탯 분배 + 추가(장비) */
export function finalStats(cls: ClassId, lv: number, a: Alloc, bonus: Bonus = {}): Stats {
  const s = baseStats(cls, lv);
  const main = CLASS_BY_ID[cls].mainStat;
  const atkPer = (k: StatKey) => (k === main ? 1.5 : k === 'str' ? 0.9 : 0.4);
  s.atk += a.str * atkPer('str') + a.dex * atkPer('dex') + a.int * atkPer('int');
  s.crit += a.dex * 0.0035;
  s.mhp += a.vit * 14;
  s.def += a.vit * 0.5;
  s.mmp += a.int * 7;
  s.mhp += bonus.mhp ?? 0;
  s.mmp += bonus.mmp ?? 0;
  s.atk += bonus.atk ?? 0;
  s.def += bonus.def ?? 0;
  s.crit += bonus.crit ?? 0;
  s.speed += bonus.speed ?? 0;
  s.atk = Math.round(s.atk);
  s.def = Math.round(s.def);
  s.crit = Math.min(0.75, s.crit);
  return s;
}

/** 다음 레벨까지 필요한 경험치 */
export function expToNext(lv: number): number {
  return Math.round(60 * Math.pow(lv, 1.75) + 40 * lv);
}

export function skillMax(def: ActionDef): number {
  return def.max ?? 5;
}

/** 스킬 레벨에 따른 피해 배율 */
export function skillMul(slv: number): number {
  return 1 + 0.12 * Math.max(0, slv - 1);
}

/** 스킬 레벨에 따른 MP 비용 */
export function skillMp(def: ActionDef, slv: number): number {
  return Math.round((def.mp ?? 0) * (1 + 0.06 * Math.max(0, slv - 1)));
}

/** 행동이 앞으로 움직이는 거리(서버 이동 검사의 여유분) */
export function actionTravel(def: ActionDef): number {
  let d = 0;
  for (const [a, b, v] of def.move ?? []) d += Math.abs(v) * (b - a + 1) / 60;
  return d;
}

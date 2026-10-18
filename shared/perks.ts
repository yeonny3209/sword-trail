import type { Bonus } from './rules';

/** 능력치 말고 전투·성장에 걸리는 추가 효과(장비 세트·룬·전직이 준다) */
export interface Fx {
  /** 치명타 피해 증가(0.2 = +20%p) */
  critDmg?: number;
  /** 스킬 재사용 시간 감소 */
  cdr?: number;
  /** 준 피해의 이만큼을 HP로 */
  leech?: number;
  /** 처치할 때 최대 HP·MP의 이만큼 회복 */
  hpOnKill?: number;
  mpOnKill?: number;
  /** 경험치 획득 증가 */
  expUp?: number;
  /** 모든 피해 증가 */
  dmgMul?: number;
  /** 보스·레이드 보스에게 주는 피해 증가 */
  bossDmg?: number;
  /** 능력치 비율 증가 */
  atkPct?: number;
  defPct?: number;
  mhpPct?: number;
  mmpPct?: number;
}

/** 능력치 + 추가 효과 한 묶음 */
export type Perk = Bonus & Fx;

export const FX_KEYS: (keyof Fx)[] = ['critDmg', 'cdr', 'leech', 'hpOnKill', 'mpOnKill', 'expUp', 'dmgMul', 'bossDmg', 'atkPct', 'defPct', 'mhpPct', 'mmpPct'];

export const FX_LABEL: Record<keyof Fx, string> = {
  critDmg: '치명타 피해', cdr: '재사용 시간 감소', leech: '피해 흡수(HP)', hpOnKill: '처치 시 HP 회복', mpOnKill: '처치 시 MP 회복',
  expUp: '경험치 획득', dmgMul: '주는 피해', bossDmg: '보스에게 주는 피해', atkPct: '공격력', defPct: '방어력', mhpPct: '최대 HP', mmpPct: '최대 MP',
};

/** 합친 뒤 넘지 못하는 한도(너무 센 조합 방지) */
export const FX_CAP: Partial<Record<keyof Fx, number>> = { critDmg: 1, cdr: 0.4, leech: 0.12, hpOnKill: 0.1, mpOnKill: 0.1, expUp: 0.5, dmgMul: 0.5, bossDmg: 0.6 };

const STAT_LABEL: Record<keyof Bonus, string> = { atk: '공격력', def: '방어력', mhp: '최대 HP', mmp: '최대 MP', crit: '치명타 확률', speed: '이동 속도' };

/** 한 줄 설명들 */
export function perkLines(p: Perk): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(p) as [string, number][]) {
    if (!v) continue;
    if (k in STAT_LABEL) out.push(`${STAT_LABEL[k as keyof Bonus]} +${k === 'crit' ? `${(v * 100).toFixed(1)}%` : k === 'speed' ? v.toFixed(2) : Math.round(v)}`);
    else if (k in FX_LABEL) out.push(`${FX_LABEL[k as keyof Fx]} +${(v * 100).toFixed(v < 0.1 && v * 100 % 1 ? 1 : 0)}%`);
  }
  return out;
}

/** a에 b를 더한다 */
export function addPerk(a: Perk, b: Perk | undefined, times = 1): Perk {
  if (!b) return a;
  for (const [k, v] of Object.entries(b) as [keyof Perk, number][]) a[k] = (a[k] ?? 0) + v * times;
  return a;
}

/** 한도를 적용한 효과 */
export function capFx<T extends Perk>(p: T): T {
  for (const [k, cap] of Object.entries(FX_CAP) as [keyof Fx, number][]) if (p[k] !== undefined) p[k] = Math.min(cap, p[k]!);
  return p;
}

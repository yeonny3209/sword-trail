import { gearBonus, ITEMS, type Equip } from './items';
import { branchPerk } from './branch';
import { addPerk, capFx, type Fx, type Perk } from './perks';
import { setPerks } from './sets';
import type { Bonus } from './rules';

/** 룬이 주는 효과 합계 */
export function runePerks(eq: Equip): Perk {
  const sum: Perk = {};
  for (const it of Object.values(eq)) for (const r of it?.sock ?? []) addPerk(sum, ITEMS[r]?.rune);
  return sum;
}

/** 장비(능력치)·룬·세트·전직 효과를 모두 합친 능력치 보너스와 추가 효과 */
export function gearPerks(eq: Equip, branch?: string): { bonus: Bonus; fx: Fx } {
  const sum: Perk = { ...gearBonus(eq) };
  addPerk(sum, runePerks(eq));
  addPerk(sum, setPerks(eq));
  addPerk(sum, branchPerk(branch));
  for (const k of ['atk', 'def', 'mhp', 'mmp'] as const) if (sum[k]) sum[k] = Math.round(sum[k]!);
  const { atk, def, mhp, mmp, crit, speed, ...fx } = capFx(sum);
  return { bonus: { atk, def, mhp, mmp, crit, speed }, fx };
}

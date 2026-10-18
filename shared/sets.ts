import setsJson from '../data/sets.json';
import { ITEMS, SLOTS, type Equip } from './items';
import { addPerk, type Perk } from './perks';

/** 장비 세트: 같은 단계(tier)의 부위를 여러 개 입으면 효과가 붙는다. 무기도 한 부위(내 직업 무기) */
export interface SetDef {
  id: string;
  name: string;
  tier: number;
  lv: number;
  /** 입은 부위 수(2·4·6) → 추가 효과 */
  bonus: Record<string, Perk>;
}

export const SET_LIST = (setsJson as { list: SetDef[] }).list;
export const SETS: Record<string, SetDef> = Object.fromEntries(SET_LIST.map((s) => [s.id, s]));
export const SET_STEPS = [2, 4, 6];

/** 이 아이템이 속한 세트 id(없으면 null). 아이템 id 끝의 단계 숫자로 정한다: helmet_5, w_swordsman_5 … */
export function setOf(itemId: string): string | null {
  const d = ITEMS[itemId];
  if (!d || d.kind !== 'equip') return null;
  const m = itemId.match(/_(\d+)$/);
  const tier = m ? Number(m[1]) : -1;
  return SETS[`set${tier}`] ? `set${tier}` : null;
}

/** 입은 장비에서 세트별 부위 수 */
export function setCounts(eq: Equip): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SLOTS) {
    const it = eq[s];
    const id = it && setOf(it.id);
    if (id) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/** 세트 효과 합계 */
export function setPerks(eq: Equip): Perk {
  const sum: Perk = {};
  for (const [id, n] of Object.entries(setCounts(eq))) {
    for (const step of SET_STEPS) if (n >= step) addPerk(sum, SETS[id].bonus[String(step)]);
  }
  return sum;
}

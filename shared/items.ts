import itemsJson from '../data/items.json';
import shopsJson from '../data/shops.json';
import lootJson from '../data/loot.json';
import type { Bonus } from './rules';
import type { ClassId } from './types';

export type Slot = 'weapon' | 'helmet' | 'armor' | 'gloves' | 'boots' | 'ring' | 'necklace';
export const SLOTS: Slot[] = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'ring', 'necklace'];
export const SLOT_NAMES: Record<Slot, string> = {
  weapon: '무기', helmet: '투구', armor: '갑옷', gloves: '장갑', boots: '신발', ring: '반지', necklace: '목걸이',
};
export const SLOT_ICONS: Record<Slot, string> = {
  weapon: '⚔', helmet: '⛑', armor: '🛡', gloves: '🧤', boots: '👢', ring: '💍', necklace: '📿',
};

export interface ItemDef {
  id: string;
  name: string;
  kind: 'equip' | 'potion' | 'material';
  slot?: Slot;
  cls?: ClassId;
  lv: number;
  stats?: Bonus;
  heal?: { hp?: number; mp?: number };
  price: number;
  stack?: number;
  desc?: string;
}

/** 가방 속 아이템 한 칸 */
export interface Item {
  uid: string;
  id: string;
  n: number;
  /** 등급 0~4 */
  rar?: number;
  /** 무작위 추가 옵션 */
  opt?: Bonus;
  /** 강화 단계 */
  enh?: number;
}

export type Equip = Partial<Record<Slot, Item>>;

export interface LootData {
  rarity: { name: string; color: string; w: number }[];
  sellRate: number;
  invSize: number;
  potionCooldown: number;
  enhance: { rates: number[]; max: number; failDropFrom: number; goldBase: number; stoneBase: number };
  drops: Record<string, { item: string; chance: number; n?: number }[]>;
  equipChance: { default: number; boss: number };
}

export const ITEMS: Record<string, ItemDef> = Object.fromEntries((itemsJson.list as unknown as ItemDef[]).map((i) => [i.id, i]));
export const SHOPS = shopsJson as unknown as Record<string, { name: string; items: string[] }>;
export const LOOT = lootJson as unknown as LootData;
export const STAT_LABEL: Record<keyof Bonus, string> = { atk: '공격력', def: '방어력', mhp: '최대 HP', mmp: '최대 MP', crit: '치명타', speed: '이동 속도' };

export function rarityName(r = 0): string {
  return LOOT.rarity[r]?.name ?? '';
}

export function rarityColor(r = 0): string {
  return LOOT.rarity[r]?.color ?? '#ddd';
}

export function itemName(it: Item): string {
  const d = ITEMS[it.id];
  return `${it.enh ? `+${it.enh} ` : ''}${d?.name ?? it.id}`;
}

/** 강화 배율(단계가 높을수록 가파르게) */
export function enhFactor(enh = 0): number {
  return 0.07 * enh + 0.03 * Math.pow(Math.max(0, enh - 7), 1.3);
}

/** 아이템 하나가 주는 능력치: 기본 × 등급 + 옵션 + 강화 */
export function itemBonus(it: Item): Bonus {
  const d = ITEMS[it.id];
  const out: Bonus = {};
  if (!d?.stats) return out;
  const rm = 1 + 0.12 * (it.rar ?? 0);
  const ef = enhFactor(it.enh);
  for (const [k, v] of Object.entries(d.stats) as [keyof Bonus, number][]) {
    const main = d.slot === 'weapon' ? k === 'atk' : d.slot === 'ring' || d.slot === 'necklace' ? true : k === 'def';
    out[k] = (out[k] ?? 0) + v * rm * (1 + (main ? ef : ef * 0.3));
  }
  for (const [k, v] of Object.entries(it.opt ?? {}) as [keyof Bonus, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
}

export function gearBonus(eq: Equip): Bonus {
  const sum: Bonus = {};
  for (const it of Object.values(eq)) {
    if (!it) continue;
    for (const [k, v] of Object.entries(itemBonus(it)) as [keyof Bonus, number][]) sum[k] = (sum[k] ?? 0) + v;
  }
  for (const k of ['atk', 'def', 'mhp', 'mmp'] as const) if (sum[k]) sum[k] = Math.round(sum[k]!);
  return sum;
}

/** 등급 굴리기: r은 0~1 난수 */
export function rollRarity(r: number, bonus = 0): number {
  const ws = LOOT.rarity.map((x, i) => x.w * (i === 0 ? 1 : 1 + bonus));
  let t = r * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ws.length; i++) if ((t -= ws[i]) <= 0) return i;
  return 0;
}

/** 무작위 추가 옵션: 등급 수만큼 */
export function rollOptions(d: ItemDef, rar: number, rnd: () => number): Bonus {
  const pool: [keyof Bonus, number][] = [
    ['atk', 1 + d.lv * 0.55], ['def', 1 + d.lv * 0.35], ['mhp', 10 + d.lv * 6], ['mmp', 6 + d.lv * 3.5], ['crit', 0.008 + d.lv * 0.0006],
  ];
  const opt: Bonus = {};
  for (let i = 0; i < rar; i++) {
    const [k, mag] = pool[Math.floor(rnd() * pool.length)];
    const v = mag * (0.5 + rnd() * 0.5);
    opt[k] = Math.round(((opt[k] ?? 0) + v) * (k === 'crit' ? 1000 : 1)) / (k === 'crit' ? 1000 : 1);
  }
  return opt;
}

export function makeItem(id: string, n: number, uid: string, rar = 0, rnd: () => number = Math.random): Item {
  const d = ITEMS[id];
  if (d?.kind === 'equip') return { uid, id, n: 1, rar, opt: rollOptions(d, rar, rnd), enh: 0 };
  return { uid, id, n };
}

/** 장착 가능 여부(불가면 이유) */
export function cannotEquip(cls: ClassId, lv: number, d: ItemDef): string | null {
  if (d.kind !== 'equip' || !d.slot) return '장비가 아닙니다.';
  if (d.cls && d.cls !== cls) return '다른 직업의 무기입니다.';
  if (d.lv > lv) return `레벨 ${d.lv}부터 착용할 수 있습니다.`;
  return null;
}

export function sellPrice(it: Item): number {
  const d = ITEMS[it.id];
  if (!d) return 0;
  const rm = 1 + (it.rar ?? 0) * 0.6 + (it.enh ?? 0) * 0.2;
  return Math.max(1, Math.floor(d.price * LOOT.sellRate * rm));
}

export function enhanceRate(enh: number): number {
  return LOOT.enhance.rates[enh] ?? 0;
}

export function enhanceCost(it: Item): { gold: number; stones: number } {
  const d = ITEMS[it.id];
  const e = it.enh ?? 0;
  const lvMul = 1 + (d?.lv ?? 1) / 10;
  return {
    gold: Math.round(LOOT.enhance.goldBase * lvMul * (1 + e) * (1 + e * 0.15)),
    stones: LOOT.enhance.stoneBase + Math.floor(e / 3),
  };
}

/** 툴팁용 능력치 줄 */
export function bonusLines(b: Bonus): string[] {
  return (Object.entries(b) as [keyof Bonus, number][])
    .filter(([, v]) => v)
    .map(([k, v]) => `${STAT_LABEL[k]} +${k === 'crit' ? `${(v * 100).toFixed(1)}%` : k === 'speed' ? v.toFixed(2) : Math.round(v)}`);
}

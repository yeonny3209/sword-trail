import { ITEMS, type Item, type ItemDef } from './items';

/** 경매장·우편함·거래 공용 규칙 */

export type AhCategory = 'all' | 'weapon' | 'armor' | 'acc' | 'potion' | 'material';
export const AH_CATEGORIES: [AhCategory, string][] = [
  ['all', '전체'], ['weapon', '무기'], ['armor', '방어구'], ['acc', '장신구'], ['potion', '소모품'], ['material', '재료'],
];

export interface AuctionRow {
  id: number;
  seller: string;
  item: Item;
  /** 묶음 전체 가격 */
  price: number;
  expires: number;
}

export interface MailRow {
  id: number;
  from: string;
  subject: string;
  body: string;
  gold: number;
  item: Item | null;
  at: number;
  read: boolean;
}

export interface TradeSide {
  items: Item[];
  gold: number;
  ready: boolean;
}

/** 판매되면 떼는 수수료 */
export const AUCTION_CUT = 0.05;
export const AUCTION_HOURS = 24;
export const AUCTION_MAX = 10;
export const AUCTION_PAGE = 12;
export const AUCTION_MAX_PRICE = 99_999_999;
export const MAIL_FEE = 10;
export const MAIL_KEEP_DAYS = 30;
/** 거래를 걸 수 있는 거리(m)와 거래가 끊기는 거리 */
export const TRADE_RANGE = 8;
export const TRADE_BREAK = 14;
export const TRADE_MAX_ITEMS = 8;

export function categoryOf(d: ItemDef): Exclude<AhCategory, 'all'> {
  if (d.kind === 'potion') return 'potion';
  if (d.kind === 'material') return 'material';
  if (d.slot === 'weapon') return 'weapon';
  if (d.slot === 'ring' || d.slot === 'necklace') return 'acc';
  return 'armor';
}

/** 팔렸을 때 판매자가 받는 골드 */
export function auctionProceeds(price: number): number {
  return Math.max(0, Math.floor(price * (1 - AUCTION_CUT)));
}

export function isTradable(it: Item): boolean {
  return !!ITEMS[it.id];
}

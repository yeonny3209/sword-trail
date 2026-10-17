import { describe, expect, it } from 'vitest';
import { ITEMS } from '../shared/items';
import { auctionProceeds, categoryOf } from '../shared/market';
import { partyExp } from '../shared/social';

describe('경매장', () => {
  it('판매 대금은 수수료 5%를 떼고 내림', () => {
    expect(auctionProceeds(150)).toBe(142);
    expect(auctionProceeds(1)).toBe(0);
    expect(auctionProceeds(100_000)).toBe(95_000);
  });

  it('아이템 분류', () => {
    const cats = new Set(Object.values(ITEMS).map(categoryOf));
    expect(cats).toEqual(new Set(['weapon', 'armor', 'acc', 'potion', 'material']));
    expect(categoryOf(ITEMS.pot_hp_s)).toBe('potion');
  });
});

describe('파티 경험치', () => {
  it('혼자면 그대로, 여럿이면 인원당 +20% 합계를 나눔', () => {
    expect(partyExp(100, 1)).toBe(100);
    expect(partyExp(100, 2)).toBe(60);
    expect(partyExp(100, 4)).toBe(40);
    expect(partyExp(1, 4)).toBe(1);
  });
});

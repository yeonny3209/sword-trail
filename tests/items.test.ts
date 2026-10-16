import { describe, expect, it } from 'vitest';
import { cannotEquip, enhanceCost, gearBonus, itemBonus, makeItem, rollRarity, sellPrice } from '../shared/items';

describe('items', () => {
  it('등급과 강화가 높을수록 능력치가 오른다', () => {
    const base = itemBonus({ uid: 'a', id: 'w_swordsman_1', n: 1, rar: 0 }).atk!;
    expect(itemBonus({ uid: 'a', id: 'w_swordsman_1', n: 1, rar: 3 }).atk!).toBeGreaterThan(base);
    expect(itemBonus({ uid: 'a', id: 'w_swordsman_1', n: 1, rar: 0, enh: 10 }).atk!).toBeGreaterThan(base * 1.5);
  });
  it('장비 능력치를 모두 더한다', () => {
    const b = gearBonus({ weapon: { uid: 'w', id: 'w_swordsman_0', n: 1 }, armor: { uid: 'a', id: 'armor_0', n: 1 } });
    expect(b.atk).toBe(8);
    expect(b.def).toBe(4);
  });
  it('희귀 이상 장비는 추가 옵션이 붙는다', () => {
    let s = 0.3;
    const it = makeItem('ring_1', 1, 'x', 3, () => (s = (s * 7.3) % 1));
    expect(Object.keys(it.opt ?? {}).length).toBeGreaterThan(0);
  });
  it('등급 굴리기: 0은 일반, 1에 가까우면 높은 등급', () => {
    expect(rollRarity(0)).toBe(0);
    expect(rollRarity(0.9999)).toBe(4);
  });
  it('다른 직업 무기·높은 레벨 장비는 못 낀다', () => {
    expect(cannotEquip('berserker', 30, { id: 'x', name: '', kind: 'equip', slot: 'weapon', cls: 'swordsman', lv: 1, price: 1 })).not.toBeNull();
    expect(cannotEquip('swordsman', 1, { id: 'x', name: '', kind: 'equip', slot: 'armor', lv: 5, price: 1 })).not.toBeNull();
    expect(cannotEquip('swordsman', 5, { id: 'x', name: '', kind: 'equip', slot: 'armor', lv: 5, price: 1 })).toBeNull();
  });
  it('강화 비용은 단계마다 오르고, 판매가는 0보다 크다', () => {
    const a = enhanceCost({ uid: 'a', id: 'armor_1', n: 1, enh: 0 });
    const b = enhanceCost({ uid: 'a', id: 'armor_1', n: 1, enh: 9 });
    expect(b.gold).toBeGreaterThan(a.gold);
    expect(sellPrice({ uid: 'a', id: 'mat_jelly', n: 1 })).toBeGreaterThan(0);
  });
});

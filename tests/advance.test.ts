import { describe, expect, it } from 'vitest';
import { ACTIONS, CLASSES, KITS, isSkill } from '../shared/data';
import { allBranchSkills, BRANCHES, BRANCH_RULES, branchAllows, branchesOf, skillSlots } from '../shared/branch';
import { gearPerks, runePerks } from '../shared/gear';
import { ITEMS, makeItem, socketCount, type Equip } from '../shared/items';
import { SETS, SET_LIST, setCounts, setOf, setPerks } from '../shared/sets';
import { cdMul, enhancedAction, powMul } from '../shared/skillEnh';
import { finalStats, skillMp, emptyAlloc } from '../shared/rules';
import { RECIPE_LIST } from '../shared/quests';

const piece = (id: string, rar = 0) => ({ ...makeItem(id, 1, id, rar, () => 0) });

describe('장비 세트', () => {
  it('부위 수에 따라 효과가 붙는다(2·4·6)', () => {
    const eq: Equip = { weapon: piece('w_swordsman_5'), helmet: piece('helmet_5'), armor: piece('armor_5'), gloves: piece('gloves_5') };
    expect(setCounts(eq)).toEqual({ set5: 4 });
    const p = setPerks(eq);
    expect(p.def).toBe(SETS.set5.bonus['2'].def! + 0);
    expect(p.mpOnKill).toBe(0.02);
    expect(p.dmgMul).toBeUndefined();
    eq.boots = piece('boots_5');
    eq.ring = piece('ring_5');
    expect(setPerks(eq).dmgMul).toBe(0.1);
  });

  it('섞어 입으면 각 세트에 따로 센다', () => {
    const eq: Equip = { helmet: piece('helmet_5'), armor: piece('armor_4') };
    expect(setCounts(eq)).toEqual({ set5: 1, set4: 1 });
    expect(Object.keys(setPerks(eq))).toHaveLength(0);
  });

  it('세트는 장비 단계 2~7에 모두 있고 모든 직업 무기가 속한다', () => {
    expect(SET_LIST).toHaveLength(6);
    for (const c of CLASSES) for (let t = 2; t <= 7; t++) expect(setOf(`w_${c.id}_${t}`), `${c.id}_${t}`).toBe(`set${t}`);
    expect(setOf('w_swordsman_0')).toBeNull();
    expect(setOf('pot_hp_s')).toBeNull();
  });
});

describe('룬 소켓', () => {
  it('등급이 소켓 수를 정하고 룬 능력치가 더해진다', () => {
    expect([0, 1, 2, 3, 4].map((r) => socketCount(piece('armor_3', r)))).toEqual([0, 1, 2, 3, 3]);
    expect(socketCount(piece('pot_hp_s'))).toBe(0);
    const it = piece('w_swordsman_3', 2);
    it.sock = ['rune_ruby_3', 'rune_blood_2'];
    const r = runePerks({ weapon: it });
    expect(r.atk).toBe(ITEMS.rune_ruby_3.rune!.atk);
    expect(r.leech).toBe(ITEMS.rune_blood_2.rune!.leech);
  });

  it('효과 한도(흡혈·재사용 시간 감소)를 넘지 않는다', () => {
    const eq: Equip = {};
    const slots = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'ring', 'necklace'] as const;
    for (const s of slots) {
      const it = piece(s === 'weapon' ? 'w_swordsman_3' : `${s}_3`, 3);
      it.sock = ['rune_blood_3', 'rune_blood_3', 'rune_swift_3'];
      eq[s] = it;
    }
    const { fx } = gearPerks(eq);
    expect(fx.leech).toBe(0.12);
    expect(fx.cdr).toBeLessThanOrEqual(0.4);
  });

  it('모든 룬 종류에 1~3단계가 있고 합성 제작법이 이어진다', () => {
    const runes = Object.values(ITEMS).filter((d) => d.kind === 'rune');
    expect(runes).toHaveLength(30);
    for (const d of runes) expect(Object.keys(d.rune!).length).toBe(1);
    for (const r of RECIPE_LIST.filter((x) => x.out.startsWith('rune_'))) {
      expect(r.need[0][1]).toBe(3);
      expect(ITEMS[r.need[0][0]].kind).toBe('rune');
    }
    expect(RECIPE_LIST.filter((x) => x.out.startsWith('rune_'))).toHaveLength(20);
  });
});

describe('전직', () => {
  it('직업마다 두 갈래, 갈래마다 전직 스킬 둘이 kits에 있다', () => {
    for (const c of CLASSES) {
      const bs = branchesOf(c.id);
      expect(bs, c.id).toHaveLength(2);
      for (const b of bs) {
        expect(b.skills).toHaveLength(2);
        for (const id of b.skills) {
          const a = ACTIONS[id];
          expect(a, id).toBeTruthy();
          expect(KITS[c.id].actions.includes(a)).toBe(true);
          expect(KITS[c.id].skills.includes(id)).toBe(false);
          expect(a.lv).toBeGreaterThanOrEqual(BRANCH_RULES.unlockLv);
          expect(a.max).toBe(3);
          expect(isSkill(c.id, id)).toBe(true);
          expect(a.hits.length > 0 || !!a.cast, id).toBe(true);
          if (a.cast) expect(a.cast.at).toBeLessThan(a.len);
        }
      }
    }
    expect(Object.keys(BRANCHES)).toHaveLength(12);
  });

  it('스킬바 12칸, 내 갈래가 아닌 전직 스킬은 못 쓴다', () => {
    const base = KITS.swordsman.skills;
    expect(skillSlots(base)).toHaveLength(12);
    expect(skillSlots(base).slice(10)).toEqual([null, null]);
    expect(skillSlots(base, 'sw_blade').slice(10)).toEqual(['sw_b1a', 'sw_b1b']);
    expect(branchAllows('swordsman', 'sw_b1a', 'sw_blade')).toBe(true);
    expect(branchAllows('swordsman', 'sw_b1a', 'sw_paladin')).toBe(false);
    expect(branchAllows('swordsman', 'sw_b1a')).toBe(false);
    expect(branchAllows('swordsman', 'sw_upper')).toBe(true);
    expect(allBranchSkills('buffer')).toHaveLength(4);
  });

  it('전직 보너스가 능력치에 반영된다', () => {
    const none = gearPerks({}, undefined);
    const blade = gearPerks({}, 'sw_blade');
    expect(blade.fx.critDmg).toBe(0.2);
    expect(blade.bonus.crit).toBe(0.03);
    const a = finalStats('swordsman', 30, emptyAlloc(), none.bonus, none.fx);
    const b = finalStats('swordsman', 30, emptyAlloc(), blade.bonus, blade.fx);
    expect(b.atk).toBeGreaterThan(a.atk);
    const pal = gearPerks({}, 'sw_paladin');
    expect(finalStats('swordsman', 30, emptyAlloc(), pal.bonus, pal.fx).mhp).toBeGreaterThan(a.mhp);
  });
});

describe('스킬 강화', () => {
  const d = ACTIONS.sw_quake;

  it('광역은 판정이 25% 커지고 나머지는 그대로', () => {
    expect(enhancedAction(d, 'pow')).toBe(d);
    const w = enhancedAction(d, 'wide');
    expect(w.hits[0].shape.range).toBeCloseTo(d.hits[0].shape.range * 1.25, 1);
    expect(d.hits[0].shape.range).toBe(3.6);
    expect(enhancedAction(d, 'wide')).toBe(w);
    const arc = enhancedAction(ACTIONS.sw_upper, 'wide').hits[0].shape;
    expect(arc.width).toBeGreaterThan(ACTIONS.sw_upper.hits[0].shape.width);
    expect(arc.width).toBeLessThanOrEqual(340);
  });

  it('위력·쾌속 배율', () => {
    expect(powMul('pow')).toBe(1.25);
    expect(powMul('haste')).toBe(1);
    expect(cdMul('haste')).toBe(0.75);
    expect(cdMul('', 0.2)).toBeCloseTo(0.8);
    expect(cdMul('haste', 0.9)).toBeCloseTo(0.375);
    expect(skillMp(d, 1, 'haste')).toBeLessThan(skillMp(d, 1));
  });
});

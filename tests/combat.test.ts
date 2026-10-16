import { describe, expect, it } from 'vitest';
import { applyReaction, expFactor, isBackAttack, newBody, rollDamage, stepBody } from '../shared/combat';
import type { HitDef } from '../shared/types';

const hit = (o: Partial<HitDef> = {}): HitDef => ({
  f: [0, 0], shape: { type: 'arc', range: 2, width: 120 }, dmg: 1, kx: 4, stun: 20, stop: 5, ...o,
});

describe('reaction', () => {
  it('kz가 있으면 띄우고, 떨어지면 다운된다', () => {
    const b = newBody(0, 0);
    applyReaction(b, hit({ kz: 10 }), 1, 0, 1);
    expect(b.air).toBe(true);
    for (let i = 0; i < 60; i++) stepBody(b, 1 / 60, [], [100, 100], 0.5);
    expect(b.air).toBe(false);
    expect(b.y).toBe(0);
    expect(b.down).toBeGreaterThan(0);
  });
  it('공중 콤보는 할수록 덜 뜬다', () => {
    const b = newBody(0, 0);
    applyReaction(b, hit({ kz: 10 }), 1, 0, 1);
    applyReaction(b, hit({ airKz: 6 }), 1, 0, 1);
    const v1 = b.vy;
    for (let i = 0; i < 6; i++) applyReaction(b, hit({ airKz: 6 }), 1, 0, 1);
    b.vy = 0;
    applyReaction(b, hit({ airKz: 6 }), 1, 0, 1);
    expect(b.vy).toBeLessThan(v1);
  });
  it('강인함이면 경직·띄우기가 없다', () => {
    const b = newBody(0, 0);
    applyReaction(b, hit({ kz: 10 }), 1, 0, 1, true);
    expect(b.air).toBe(false);
    expect(b.stun).toBe(0);
  });
});

describe('damage', () => {
  const base = { crit: false, critMul: 1.5, back: false, counter: false };
  it('치명타·백어택·카운터가 피해를 늘린다', () => {
    const n = rollDamage(100, 1, 0, 0.5, base);
    expect(rollDamage(100, 1, 0, 0.5, { ...base, crit: true })).toBeGreaterThan(n);
    expect(rollDamage(100, 1, 0, 0.5, { ...base, counter: true })).toBeGreaterThan(n);
    expect(rollDamage(100, 1, 0, 0.5, { ...base, back: true })).toBeGreaterThan(n);
  });
  it('방어가 높을수록 덜 들어간다', () => {
    expect(rollDamage(100, 1, 100, 0.5, base)).toBeLessThan(rollDamage(100, 1, 0, 0.5, base));
  });
  it('뒤에서 치면 백어택', () => {
    expect(isBackAttack(0, 0, -2, 0, 0)).toBe(true);
    expect(isBackAttack(0, 0, 2, 0, 0)).toBe(false);
  });
  it('낮은 레벨 몬스터는 경험치가 적다', () => {
    expect(expFactor(10, 2)).toBeLessThan(expFactor(10, 10));
  });
});

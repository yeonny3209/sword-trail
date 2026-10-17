import { describe, expect, it } from 'vitest';
import { expBoost, expToNext, MAX_LEVEL, PROGRESSION, questExp } from '../shared/rules';

describe('성장 속도', () => {
  it('레벨이 오를수록 필요 경험치가 늘어난다', () => {
    for (let lv = 1; lv < MAX_LEVEL; lv++) expect(expToNext(lv + 1)).toBeGreaterThan(expToNext(lv));
  });

  it('초반은 빠르게: 레벨 1은 슬라임 몇 마리면 오른다', () => {
    expect(expToNext(1)).toBeLessThanOrEqual(60);
    expect(expToNext(10)).toBeLessThan(1500);
  });

  it('퀘스트 경험치에 배율이 붙는다', () => {
    expect(questExp(100)).toBe(Math.round(100 * PROGRESSION.questExpRate));
  });
});

describe('중반 경험치 보너스', () => {
  it('초반·후반은 1배, 중반은 1.5배, 사이는 서서히', () => {
    expect(expBoost(1)).toBe(1);
    expect(expBoost(8)).toBe(1);
    expect(expBoost(12)).toBeCloseTo(1.5);
    expect(expBoost(20)).toBeCloseTo(1.5);
    expect(expBoost(25)).toBeCloseTo(1.5);
    expect(expBoost(32)).toBe(1);
    expect(expBoost(40)).toBe(1);
    expect(expBoost(10)).toBeGreaterThan(1);
    expect(expBoost(10)).toBeLessThan(1.5);
    expect(expBoost(28)).toBeGreaterThan(1);
    expect(expBoost(28)).toBeLessThan(1.5);
  });

  it('퀘스트 경험치도 레벨 보너스를 받는다', () => {
    expect(questExp(100, 20)).toBeGreaterThan(questExp(100, 1));
  });
});

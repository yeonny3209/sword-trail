import { describe, expect, it } from 'vitest';
import { expToNext, MAX_LEVEL, PROGRESSION, questExp } from '../shared/rules';

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

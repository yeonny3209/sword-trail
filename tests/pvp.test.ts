import { describe, expect, it } from 'vitest';
import { PVP, ratingGain } from '../shared/pvp';

describe('결투장 점수', () => {
  it('같은 점수끼리는 K의 절반', () => {
    expect(ratingGain(1000, 1000)).toBe(PVP.ratingK / 2);
  });

  it('강한 상대를 이기면 더 많이, 약한 상대는 적게(최소 1)', () => {
    expect(ratingGain(1000, 1400)).toBeGreaterThan(ratingGain(1000, 1000));
    expect(ratingGain(1400, 1000)).toBeLessThan(ratingGain(1000, 1000));
    expect(ratingGain(3000, 0)).toBe(1);
  });
});

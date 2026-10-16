import { describe, expect, it } from 'vitest';
import { resolveCircle, shapeHits } from '../shared/geom';
import { baseStats, expToNext } from '../shared/rules';

describe('resolveCircle', () => {
  const walls = [{ x: 0, z: 0, w: 2, d: 2 }];
  it('벽 밖으로 밀어낸다', () => {
    const [x, z] = resolveCircle(1.2, 0, 0.4, walls, [20, 20]);
    expect(x).toBeCloseTo(1.4);
    expect(z).toBeCloseTo(0);
  });
  it('벽 안에 있으면 가까운 면으로', () => {
    const [x] = resolveCircle(0.8, 0, 0.4, walls, [20, 20]);
    expect(x).toBeCloseTo(1.4);
  });
  it('존 경계를 넘지 않는다', () => {
    const [x, z] = resolveCircle(50, -50, 0.4, [], [20, 20]);
    expect(x).toBeCloseTo(9.6);
    expect(z).toBeCloseTo(-9.6);
  });
});

describe('shapeHits', () => {
  it('부채꼴: 앞은 맞고 뒤는 안 맞는다', () => {
    const arc = { type: 'arc' as const, range: 2, width: 120 };
    expect(shapeHits(arc, 0, 0, 0, 0, 1.5, 0.4)).toBe(true);
    expect(shapeHits(arc, 0, 0, 0, 0, -1.5, 0.4)).toBe(false);
  });
  it('직사각형: 폭 밖은 빗나간다', () => {
    const box = { type: 'box' as const, range: 4, width: 1 };
    expect(shapeHits(box, 0, 0, 0, 0.3, 3, 0.3)).toBe(true);
    expect(shapeHits(box, 0, 0, 0, 2, 3, 0.3)).toBe(false);
  });
  it('높이 위의 공중 대상은 빗나간다', () => {
    const arc = { type: 'arc' as const, range: 2, width: 120, height: 1.5 };
    expect(shapeHits(arc, 0, 0, 0, 0, 1, 0.4, 2)).toBe(false);
  });
});

describe('rules', () => {
  it('레벨이 오르면 능력치가 오른다', () => {
    expect(baseStats('swordsman', 10).atk).toBeGreaterThan(baseStats('swordsman', 1).atk);
  });
  it('필요 경험치는 계속 늘어난다', () => {
    for (let lv = 1; lv < 40; lv++) expect(expToNext(lv + 1)).toBeGreaterThan(expToNext(lv));
  });
});

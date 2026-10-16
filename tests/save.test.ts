import { describe, expect, it } from 'vitest';
import { defaultSave, migrate, SAVE_VERSION } from '../src/progression/Save';

describe('migrate', () => {
  it('빈 값이면 기본 저장', () => {
    expect(migrate(null)).toEqual(defaultSave());
  });
  it('옛 필드(shard)를 shards로 옮긴다', () => {
    const s = migrate({ shard: 42.7 });
    expect(s.shards).toBe(42);
    expect(s.version).toBe(SAVE_VERSION);
  });
  it('빠진 설정은 기본값으로 채운다', () => {
    const s = migrate({ shards: 5, settings: { volume: 0.3 } });
    expect(s.settings).toEqual({ volume: 0.3, mouseSensitivity: 1, screenShake: true });
  });
  it('장착 검이 해금 목록에 없으면 첫 검', () => {
    const s = migrate({ swords: ['trainee'], equipped: 'odachi' });
    expect(s.equipped).toBe('trainee');
  });
  it('사망 기록은 최근 20개만', () => {
    const deaths = Array.from({ length: 30 }, (_, i) => ({ room: `r${i}`, cause: 'x', seconds: i }));
    const s = migrate({ stats: { runs: 30, wins: 0, bestSeconds: 0, deaths } });
    expect(s.stats.deaths).toHaveLength(20);
    expect(s.stats.deaths[0].room).toBe('r10');
  });
});

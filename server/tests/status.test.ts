import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIONS, CLASSES, CLASS_BY_ID, KITS, MONSTERS, ZONES } from '../../shared/data';
import { ITEMS, SHOPS } from '../../shared/items';
import { RECIPE_LIST } from '../../shared/quests';
import { BOND, castScale, STATUS } from '../../shared/status';
import type { ClassId } from '../../shared/types';
import { EliteSystem } from '../zone/Elite';
import { PlayerSession } from '../zone/PlayerSession';

const IDS = Object.keys(KITS) as ClassId[];

describe('직업·스킬 데이터', () => {
  it('직업 6개, 모두 스킬 10개', () => {
    expect(IDS.sort()).toEqual(['berserker', 'blademaster', 'buffer', 'debuffer', 'spellblade', 'swordsman']);
    expect(CLASSES.length).toBe(6);
    for (const id of IDS) expect(KITS[id].skills.length, id).toBe(10);
  });

  it('행동 id는 겹치지 않고 스킬마다 정의가 있다', () => {
    const all = IDS.flatMap((c) => KITS[c].actions.map((a) => a.id));
    expect(new Set(all).size).toBe(all.length);
    for (const c of IDS) for (const s of KITS[c].skills) expect(ACTIONS[s], s).toBeTruthy();
  });

  it('첫 스킬은 레벨 1에 배울 수 있고, 모든 스킬은 레벨 40 안에 배운다', () => {
    for (const c of IDS) {
      expect(ACTIONS[KITS[c].skills[0]].lv ?? 1, c).toBe(1);
      for (const s of KITS[c].skills) expect(ACTIONS[s].lv ?? 1).toBeLessThanOrEqual(40);
    }
  });

  it('효과(cast)는 올바른 상태효과만 쓴다: 아군엔 버프, 적엔 디버프', () => {
    let casts = 0;
    for (const a of Object.values(ACTIONS)) {
      if (!a.cast) continue;
      casts++;
      expect(a.cast.ally || a.cast.foe, a.id).toBeTruthy();
      for (const b of a.cast.ally?.buffs ?? []) expect(STATUS[b.id].debuff, `${a.id}:${b.id}`).toBe(false);
      for (const d of a.cast.foe?.debuffs ?? []) expect(STATUS[d.id].debuff, `${a.id}:${d.id}`).toBe(true);
      expect(a.cast.at).toBeLessThanOrEqual(a.len);
    }
    expect(casts).toBeGreaterThanOrEqual(20);
  });

  it('신관은 치유·소생이 있고 주술사는 디버프가 있다', () => {
    const bf = KITS.buffer.skills.map((s) => ACTIONS[s].cast);
    expect(bf.some((c) => c?.ally?.heal)).toBe(true);
    expect(bf.some((c) => c?.ally?.revive)).toBe(true);
    expect(bf.some((c) => c?.ally?.buffs?.some((b) => b.id === 'shield'))).toBe(true);
    const db = KITS.debuffer.skills.map((s) => ACTIONS[s].cast);
    for (const id of ['defDown', 'atkDown', 'slow', 'bind', 'vuln', 'poison']) {
      expect(db.some((c) => c?.foe?.debuffs.some((d) => d.id === id)), id).toBe(true);
    }
  });

  it('새 직업의 장비·상점·제작법이 이어져 있다', () => {
    for (const c of ['buffer', 'debuffer']) {
      for (let n = 0; n < 6; n++) expect(ITEMS[`w_${c}_${n}`]?.cls, `${c}${n}`).toBe(c);
      expect(Object.values(SHOPS).some((s) => s.items.includes(`w_${c}_0`))).toBe(true);
      // 1~5단계 + 후반 6·7단계 제작법
      expect(RECIPE_LIST.filter((r) => r.out.startsWith(`w_${c}_`)).length).toBe(7);
      expect(CLASS_BY_ID[c as ClassId].look).toBeTruthy();
    }
    expect(CLASS_BY_ID.buffer.weapon.kind).toBe('staff');
    expect(CLASS_BY_ID.debuffer.weapon.kind).toBe('scythe');
  });

  it('스킬 레벨이 오를수록 효과가 커진다', () => {
    expect(castScale(1)).toBe(1);
    expect(castScale(5)).toBeGreaterThan(castScale(3));
  });
});

describe('정예 몬스터 데이터', () => {
  it('일반 몬스터마다 정예 변종이 있고 훨씬 강하다', () => {
    const base = MONSTERS.slime, e = MONSTERS.slime_elite;
    expect(e.elite).toBe('slime');
    expect(e.hp).toBe(base.hp * 8);
    expect(e.exp).toBe(base.exp * 8);
    expect(e.model.scale).toBeGreaterThan(base.model.scale);
    expect(MONSTERS.gargon_elite).toBeUndefined();
    expect(MONSTERS.citadel_guard_elite).toBeUndefined();
  });
});

function fakeRow() {
  return { id: 1, account_id: 1, name: 'a', class: 'swordsman', level: 20, zone: 'town', x: 0, z: 0, data: '{}' } as never;
}

describe('플레이어 버프 계산', () => {
  const mk = () => new PlayerSession({ send() {} } as unknown as WebSocket, fakeRow(), 'town', 0, 0);

  it('공격력 버프와 파티 결속이 더해진다', () => {
    const p = mk();
    const base = p.stats.atk;
    expect(p.eff.atk).toBe(base);
    p.addBuff('atkUp', 0.2, 10);
    expect(p.eff.atk).toBe(Math.round(base * 1.2));
    p.near = 2;
    expect(p.eff.atk).toBe(Math.round(base * (1.2 + BOND.atk * 2)));
    p.near = 9;
    expect(p.eff.atk).toBe(Math.round(base * (1.2 + BOND.atk * BOND.max)));
  });

  it('같은 버프는 쌓이지 않고 센 쪽·긴 쪽을 따른다', () => {
    const p = mk();
    p.addBuff('defUp', 0.1, 5);
    p.addBuff('defUp', 0.3, 20);
    p.addBuff('defUp', 0.2, 1);
    expect(p.buffs.get('defUp')!.power).toBe(0.3);
    expect(p.buffs.get('defUp')!.until).toBeGreaterThan(Date.now() + 15_000);
  });

  it('수호는 받는 피해를 줄이고 보호막이 먼저 받는다', () => {
    const p = mk();
    expect(p.damageTaken).toBe(1);
    p.addBuff('guard', 0.25, 10);
    expect(p.damageTaken).toBe(0.75);
    p.addBuff('shield', 0.2, 10, 100);
    expect(p.absorb(60)).toBe(0);
    expect(p.absorb(60)).toBe(20);
    expect(p.absorb(10)).toBe(10);
    expect(p.pruneBuffs(Date.now())).toBe(true);
    expect(p.buffs.has('shield')).toBe(false);
  });

  it('끝난 버프는 정리된다', () => {
    const p = mk();
    p.addBuff('speedUp', 0.3, 0.001);
    expect(p.pruneBuffs(Date.now() + 50)).toBe(true);
    expect(p.eff.speed).toBe(p.stats.speed);
  });
});

describe('정예 몬스터 등장', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  function setup(type: 'field' | 'town' = 'field') {
    const spawned: { dead: boolean; temporary: boolean; def: unknown }[] = [];
    const banners: string[] = [];
    const players = new Map([[1, { x: 0, z: 0, dead: false, leaving: false }]]);
    const sys = new EliteSystem({
      zone: { ...ZONES.field1, type } as never,
      players: players as never,
      broadcast: (m) => m.t === 'banner' && banners.push(m.text),
      spawn: (def) => {
        const m = { dead: false, temporary: false, def };
        spawned.push(m);
        return m as never;
      },
    });
    return { sys, spawned, banners };
  }

  it('사냥터에서 몇 분 뒤 정예가 나타나고, 쓰러뜨리기 전엔 또 나오지 않는다', () => {
    const { sys, spawned, banners } = setup();
    sys.update(Date.now() + 10_000);
    expect(spawned.length).toBe(0);
    sys.update(Date.now() + 300_000);
    expect(spawned.length).toBe(1);
    expect(spawned[0].temporary).toBe(true);
    expect(banners[0]).toContain('정예');
    sys.update(Date.now() + 900_000);
    expect(spawned.length).toBe(1);
    spawned[0].dead = true;
    sys.update(Date.now() + 900_000);
    sys.update(Date.now() + 1_800_000);
    expect(spawned.length).toBe(2);
  });

  it('마을에서는 나타나지 않는다', () => {
    const { sys, spawned } = setup('town');
    sys.update(Date.now() + 3_000_000);
    expect(spawned.length).toBe(0);
  });
});

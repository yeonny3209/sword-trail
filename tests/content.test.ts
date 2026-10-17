import { describe, expect, it } from 'vitest';
import { CLASSES, MONSTERS, ZONES } from '../shared/data';
import { ITEMS, LOOT } from '../shared/items';
import { QUEST_LIST, QUESTS, RECIPE_LIST } from '../shared/quests';

const FIELDS = ['field1', 'field2', 'field3', 'field4', 'field5', 'field6'];

describe('사냥터 연결', () => {
  it('사냥터는 포탈로 서로 오갈 수 있다(양방향, 도착 지점이 있음)', () => {
    for (const z of Object.values(ZONES)) {
      for (const p of z.portals) {
        const dest = ZONES[p.to];
        expect(dest, `${z.id}.${p.id}`).toBeTruthy();
        const back = dest.portals.find((q) => q.id === p.toPortal);
        expect(back, `${z.id}.${p.id} → ${p.to}.${p.toPortal}`).toBeTruthy();
        expect(back!.to === z.id || ['town', 'raid1', 'raid2', 'arena'].includes(z.id) || z.type === 'town').toBe(true);
      }
    }
    const f4 = ZONES.field4.portals.find((p) => p.to === 'field5')!;
    const f5 = ZONES.field5.portals.find((p) => p.to === 'field6')!;
    expect(f4.toPortal).toBe('south');
    expect(f5.toPortal).toBe('south');
  });

  it('지역 레벨이 이어지고 몬스터·소환 구역이 존재한다', () => {
    let prevMax = 0;
    for (const id of FIELDS) {
      const z = ZONES[id];
      expect(z.level[0]).toBeLessThanOrEqual(prevMax + 1);
      expect(z.level[1]).toBeGreaterThan(prevMax);
      prevMax = z.level[1];
      expect(z.spawns.length).toBeGreaterThan(0);
      for (const s of z.spawns) {
        const m = MONSTERS[s.monster];
        expect(m, `${id}:${s.monster}`).toBeTruthy();
        expect(m.lv).toBeGreaterThanOrEqual(z.level[0] - 4);
        expect(m.lv).toBeLessThanOrEqual(z.level[1] + 1);
      }
      // 바람 언덕은 입문 지역이라 보스가 없고, 나머지 사냥터에는 필드 보스가 하나씩 있다
      if (id !== 'field1') expect(z.spawns.some((s) => MONSTERS[s.monster].boss), `${id} 보스`).toBe(true);
    }
    expect(prevMax).toBe(40);
  });

  it('지역 분위기 값이 있다(해·입자)', () => {
    for (const z of Object.values(ZONES)) {
      expect(z.sun, z.id).toBeTruthy();
      expect(z.ambient, z.id).toBeTruthy();
    }
  });
});

describe('드랍·재료·채집', () => {
  it('드랍표는 실제 몬스터와 아이템만 가리킨다', () => {
    for (const [mid, list] of Object.entries(LOOT.drops)) {
      expect(MONSTERS[mid], mid).toBeTruthy();
      for (const d of list) expect(ITEMS[d.item], `${mid}:${d.item}`).toBeTruthy();
    }
    for (const id of ['ash_wolf', 'magma_slime', 'canyon_raider', 'rock_titan', 'ember_mage', 'barga', 'frost_wolf', 'snow_wisp', 'ice_archer', 'yeti', 'frost_knight', 'siryen']) {
      expect(LOOT.drops[id]?.length, id).toBeGreaterThan(0);
    }
  });

  it('채집 단계마다 재료가 있다', () => {
    const tiers = (LOOT as unknown as { gather: { tiers: Record<string, number> } }).gather.tiers;
    for (const id of FIELDS) {
      const t = tiers[id];
      expect(t, id).toBeGreaterThanOrEqual(1);
      for (const k of ['ore', 'herb', 'wood']) expect(ITEMS[`${k}_${t}`], `${k}_${t}`).toBeTruthy();
    }
    expect(tiers.field5).toBe(4);
    expect(tiers.field6).toBe(5);
  });
});

describe('상위 장비와 제작', () => {
  it('Lv35·40 장비가 부위와 모든 직업 무기에 있다', () => {
    for (const [tier, lv] of [[6, 35], [7, 40]] as const) {
      for (const slot of ['helmet', 'armor', 'gloves', 'boots', 'ring', 'necklace']) {
        expect(ITEMS[`${slot}_${tier}`]?.lv, `${slot}_${tier}`).toBe(lv);
      }
      for (const c of CLASSES) expect(ITEMS[`w_${c.id}_${tier}`]?.lv, `w_${c.id}_${tier}`).toBe(lv);
    }
    expect(ITEMS.armor_7.stats!.def!).toBeGreaterThan(ITEMS.armor_6.stats!.def!);
    expect(ITEMS.armor_6.stats!.def!).toBeGreaterThan(ITEMS.armor_5.stats!.def!);
    expect(ITEMS.w_swordsman_7.stats!.atk!).toBeGreaterThan(ITEMS.w_swordsman_6.stats!.atk!);
  });

  it('제작법은 만들 수 있는 재료만 요구한다', () => {
    for (const r of RECIPE_LIST) {
      expect(ITEMS[r.out], r.id).toBeTruthy();
      for (const [id, n] of r.need) {
        expect(ITEMS[id], `${r.id}:${id}`).toBeTruthy();
        expect(n).toBeGreaterThan(0);
      }
    }
    expect(RECIPE_LIST.filter((r) => /_(6|7)$/.test(r.id)).length).toBe(2 * (6 + CLASSES.length));
  });
});

describe('퀘스트', () => {
  it('퀘스트 연결: 선행 퀘스트·몬스터·아이템·지역이 모두 존재한다', () => {
    for (const q of QUEST_LIST) {
      if (q.req) expect(QUESTS[q.req], `${q.id}.req`).toBeTruthy();
      for (const o of q.obj) {
        if (o.type === 'kill') expect(MONSTERS[o.target], `${q.id}:${o.target}`).toBeTruthy();
        else if (o.type === 'collect') expect(ITEMS[o.target], `${q.id}:${o.target}`).toBeTruthy();
        else expect(ZONES[o.target], `${q.id}:${o.target}`).toBeTruthy();
      }
      for (const [id] of q.reward.items ?? []) expect(ITEMS[id], `${q.id}:${id}`).toBeTruthy();
    }
    expect(QUEST_LIST.length).toBeGreaterThanOrEqual(33);
  });

  it('후반 퀘스트는 두 새 사냥터를 안내한다', () => {
    const visits = QUEST_LIST.flatMap((q) => q.obj.filter((o) => o.type === 'visit').map((o) => o.target));
    expect(visits).toContain('field5');
    expect(visits).toContain('field6');
    expect(QUESTS.m22.obj[0].target).toBe('siryen');
  });
});

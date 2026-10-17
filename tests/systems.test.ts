import { describe, expect, it } from 'vitest';
import { MONSTERS, ZONES } from '../shared/data';
import { ACH_LIST, advance, titleUnlocked } from '../shared/achievements';
import { bountyDay, bountyReward, makeBounties } from '../shared/bounty';
import { itemGoal, monsterGoal, npcGoal, questGoal, routeNext } from '../shared/guide';
import { QUESTS, QUEST_LIST } from '../shared/quests';
import { expToNext } from '../shared/rules';
import { isBossFloor, towerLevel, towerPlan, towerReward, towerScale, towerStart } from '../shared/tower';

describe('시련의 탑', () => {
  it('층 레벨은 오르다 40에서 멈추고, 그 위로는 몬스터가 세진다', () => {
    expect(towerLevel(1)).toBe(2);
    expect(towerLevel(10)).toBe(20);
    expect(towerLevel(40)).toBe(40);
    expect(towerScale(20, 1).hp).toBe(1);
    expect(towerScale(30, 1).hp).toBeGreaterThan(1);
    expect(towerScale(5, 3).hp).toBeCloseTo(2.2);
  });

  it('층마다 몬스터 구성이 있고 5층마다 보스가 나온다', () => {
    for (let f = 1; f <= 40; f++) {
      const plan = towerPlan(f, () => 0.5);
      expect(plan.length, `${f}층`).toBeGreaterThan(0);
      for (const id of plan) expect(MONSTERS[id], id).toBeTruthy();
      expect(plan.some((id) => MONSTERS[id].boss)).toBe(isBossFloor(f));
      expect(plan.some((id) => MONSTERS[id].raid)).toBe(false);
    }
  });

  it('체크포인트와 보상', () => {
    expect(towerStart(0)).toBe(1);
    expect(towerStart(4)).toBe(1);
    expect(towerStart(5)).toBe(6);
    expect(towerStart(17)).toBe(16);
    expect(towerReward(5).stones).toBeGreaterThan(0);
    expect(towerReward(4).stones).toBe(0);
    expect(towerReward(10).gold).toBeGreaterThan(towerReward(9).gold);
  });
});

describe('업적', () => {
  it('처치 수는 쌓이고 레벨·탑은 최고치만 남는다', () => {
    const p: Record<string, number> = {};
    for (let i = 0; i < 99; i++) advance(p, 'kill', 'slime', 1);
    expect(advance(p, 'kill', 'wolf', 1)).toContain('kill_100');
    expect(p.slime_50).toBe(50);
    advance(p, 'level', undefined, 25);
    advance(p, 'level', undefined, 12);
    expect(p.lv20).toBe(20);
    expect(p.lv30).toBe(25);
    expect(titleUnlocked(p, 'lv20')).toBe(true);
    expect(titleUnlocked(p, 'lv30')).toBe(false);
  });

  it('업적의 대상 몬스터는 실제로 있다', () => {
    for (const a of ACH_LIST) if (a.type === 'kill' && a.target !== '*') expect(MONSTERS[a.target!], a.id).toBeTruthy();
    expect(new Set(ACH_LIST.map((a) => a.id)).size).toBe(ACH_LIST.length);
  });
});

describe('현상 수배', () => {
  it('날짜·캐릭터마다 같은 목록, 레벨에 맞는 몬스터 3건', () => {
    const day = bountyDay(Date.UTC(2026, 9, 17, 16));
    expect(day).toBe('2026-10-18');
    const a = makeBounties(7, 20, day), b = makeBounties(7, 20, day);
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
    for (const x of a) {
      expect(MONSTERS[x.m], x.m).toBeTruthy();
      expect(MONSTERS[x.m].lv).toBeLessThanOrEqual(23);
    }
    expect(makeBounties(7, 3, day).every((x) => MONSTERS[x.m].lv <= 8)).toBe(true);
    expect(bountyReward(a[0], 20).exp).toBeGreaterThan(0);
  });
});

describe('길 안내', () => {
  it('마을에서 서리 고원까지 포탈을 이어 간다', () => {
    expect(routeNext('town', 'field6')?.to).toBe('field1');
    expect(routeNext('field3', 'town')?.to).toBe('field2');
    expect(routeNext('town', 'tower')?.to).toBe('tower');
    expect(routeNext('town', 'town')).toBeNull();
  });

  it('모든 퀘스트 목표의 위치를 찾을 수 있다', () => {
    for (const q of QUEST_LIST) {
      const g = questGoal(q, q.obj.map(() => 0), false);
      expect(g, q.id).toBeTruthy();
      expect(ZONES[g!.zone]).toBeTruthy();
      expect(questGoal(q, [], true)?.zone, `${q.id} 보고`).toBe('town');
    }
    expect(monsterGoal('frost_spider')?.zone).toBe('field6');
    expect(itemGoal('mat_silk')?.zone).toBe('field3');
    expect(itemGoal('ore_3')?.zone).toBe('field4');
    expect(npcGoal('explorer')?.zone).toBe('town');
    expect(QUESTS.t2.obj[0].target).toBe('tower');
  });

  it('퀘스트 경험치는 그 레벨 필요 경험치의 2.5배를 넘지 않는다(옛 수치로 수십 레벨 오르던 문제)', () => {
    for (const q of QUEST_LIST) expect(q.reward.exp! * 1.5, q.id).toBeLessThanOrEqual(expToNext(q.lv) * 2.5);
  });
});

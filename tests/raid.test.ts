import { describe, expect, it } from 'vitest';
import { baseZone, MONSTERS, ZONES } from '../shared/data';
import { RAID, raidHp, raidKey, raidOf } from '../shared/raid';

describe('레이드 규칙', () => {
  it('보스 체력은 한 명 늘 때마다 +75%', () => {
    expect(raidHp(60000, 1)).toBe(60000);
    expect(raidHp(60000, 2)).toBe(105000);
    expect(raidHp(60000, 4)).toBe(195000);
    expect(raidHp(60000, 0)).toBe(60000);
  });

  it('파티는 가장 작은 캐릭터 번호로 같은 방, 혼자면 자기 방', () => {
    expect(raidKey('raid1', [9, 4, 12], 12)).toBe('raid1~4');
    expect(raidKey('raid1', [4, 9], 9)).toBe('raid1~4');
    expect(raidKey('raid1', [], 7)).toBe('raid1~7');
  });

  it('방 이름에서 존 종류를 알아낸다', () => {
    expect(baseZone('raid1~4')).toBe('raid1');
    expect(baseZone('town')).toBe('town');
    expect(ZONES[baseZone('raid1~4')].type).toBe('raid');
  });

  it('데이터 연결: 보스·부하·입장 포탈이 서로 이어져 있다', () => {
    const boss = MONSTERS.gargon;
    expect(boss.raid).toBeTruthy();
    expect(MONSTERS[boss.raid!.adds]).toBeTruthy();
    expect(boss.raid!.phases.every((p) => p > 0 && p < 1)).toBe(true);
    for (const d of RAID.dungeons) {
      const raid = ZONES[d.zone];
      expect(raid.type).toBe('raid');
      const bossId = raid.spawns.map((s) => s.monster).find((id) => MONSTERS[id]?.raid);
      expect(bossId).toBeTruthy();
      expect(MONSTERS[MONSTERS[bossId!].raid!.adds]).toBeTruthy();
      const gate = ZONES.town.portals.find((p) => p.to === d.zone)!;
      expect(raid.portals.find((p) => p.id === gate.toPortal)).toBeTruthy();
      expect(ZONES.town.portals.find((p) => p.id === raid.portals[0].toPortal)).toBeTruthy();
      expect(raidOf(d.zone)).toBe(d);
    }
  });
});

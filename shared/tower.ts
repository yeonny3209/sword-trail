import towerJson from '../data/tower.json';
import { MONSTERS } from './data';
import { expToNext } from './rules';
import type { MonsterDef } from './types';

/** 시련의 탑 규칙(수치는 data/tower.json) */
export interface TowerConfig {
  /** 층마다 제한 시간(초) */
  floorSec: number;
  /** 층을 깨고 다음 층까지 쉬는 시간(초) */
  breakSec: number;
  /** 이 층마다 다음 도전을 여기서 시작할 수 있다 */
  checkpoint: number;
  lvStart: number;
  lvPerFloor: number;
  baseCount: number;
  countPer3Floors: number;
  maxCount: number;
  bossEvery: number;
  /** 몬스터 레벨이 최고(40)를 넘어선 층마다 체력·공격력 증가 */
  overHp: number;
  overAtk: number;
  /** 한 명 늘 때마다 몬스터 체력 증가 */
  partyHp: number;
  goldPerFloor: number;
  /** 층 돌파 경험치: 그 층 레벨의 필요 경험치 × 이 비율 */
  expShare: number;
  stonesPerBoss: number;
  equipChanceBoss: number;
  exclude: string[];
}

export const TOWER = towerJson as TowerConfig;
export const TOWER_ZONE = 'tower';

/** 층의 몬스터 레벨(최고 40) */
export function towerLevel(floor: number): number {
  return Math.min(40, TOWER.lvStart + (floor - 1) * TOWER.lvPerFloor);
}

/** 몬스터 레벨이 최고에 닿은 뒤 층마다 세지는 배율 */
export function towerScale(floor: number, players: number): { hp: number; atk: number } {
  const over = Math.max(0, floor - (Math.ceil((40 - TOWER.lvStart) / TOWER.lvPerFloor) + 1));
  return { hp: (1 + TOWER.overHp * over) * (1 + TOWER.partyHp * (Math.max(1, players) - 1)), atk: 1 + TOWER.overAtk * over };
}

export function isBossFloor(floor: number): boolean {
  return floor % TOWER.bossEvery === 0;
}

const normals = (): MonsterDef[] => Object.values(MONSTERS).filter((m) => !m.boss && !m.raid && !m.elite && !TOWER.exclude.includes(m.id));
const bosses = (): MonsterDef[] => Object.values(MONSTERS).filter((m) => m.boss && !m.raid && !m.elite);

/** 이 층에 나올 몬스터 id 목록. rnd: 0~1 난수 함수 */
export function towerPlan(floor: number, rnd: () => number): string[] {
  const lv = towerLevel(floor);
  const pool = normals();
  let near = pool.filter((m) => m.lv >= lv - 5 && m.lv <= lv + 1);
  if (!near.length) near = [...pool].sort((a, b) => Math.abs(a.lv - lv) - Math.abs(b.lv - lv)).slice(0, 3);
  const pick = () => near[Math.floor(rnd() * near.length)].id;
  if (isBossFloor(floor)) {
    const bs = bosses().filter((b) => b.lv <= lv + 4).sort((a, b) => b.lv - a.lv);
    const boss = bs[0] ?? bosses().sort((a, b) => a.lv - b.lv)[0];
    return [boss.id, pick(), pick()];
  }
  const n = Math.min(TOWER.maxCount, TOWER.baseCount + Math.floor((floor - 1) / 3) * TOWER.countPer3Floors);
  return Array.from({ length: n }, pick);
}

/** 가장 높이 오른 층에서 다음 도전을 시작할 층(체크포인트) */
export function towerStart(best: number): number {
  return 1 + Math.floor(Math.max(0, best) / TOWER.checkpoint) * TOWER.checkpoint;
}

/** 층 돌파 보상 */
export function towerReward(floor: number): { gold: number; exp: number; stones: number } {
  const lv = towerLevel(floor);
  return {
    gold: TOWER.goldPerFloor * floor,
    exp: Math.round(expToNext(lv) * TOWER.expShare),
    stones: isBossFloor(floor) ? TOWER.stonesPerBoss + Math.floor(floor / 10) : 0,
  };
}

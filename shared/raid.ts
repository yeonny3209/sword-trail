import raidJson from '../data/raid.json';

/** 레이드(파티 전용 던전) 규칙. 수치는 data/raid.json */
export interface RaidConfig {
  zone: string;
  minLevel: number;
  maxPlayers: number;
  /** 한 명 늘 때마다 보스 체력이 이만큼 늘어난다(0.75 = +75%) */
  hpPerExtraPlayer: number;
  rewardRarityBonus: number;
  minRarity: number;
  mats: { item: string; n: [number, number] }[];
}

export const RAID = raidJson as RaidConfig;

/** 인원수에 맞춘 보스 최대 체력 */
export function raidHp(base: number, players: number): number {
  return Math.round(base * (1 + RAID.hpPerExtraPlayer * (Math.max(1, players) - 1)));
}

/**
 * 레이드 방 이름. 파티는 가장 작은 캐릭터 번호로 한 방을 같이 쓰고, 혼자면 자기 방.
 * 존 이름 뒤에 `~번호`를 붙인 것이 존 서버(Durable Object)의 이름이 된다.
 */
export function raidKey(zoneId: string, party: number[], selfId: number): string {
  const ids = party.length ? party : [selfId];
  return `${zoneId}~${Math.min(...ids)}`;
}

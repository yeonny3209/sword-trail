import pvpJson from '../data/pvp.json';
import type { ClassId } from './types';

/** 결투장(PvP) 규칙 */
export interface PvpConfig {
  /** 플레이어끼리 피해 배율(싸움이 너무 빨리 끝나지 않게) */
  damageScale: number;
  reviveWait: number;
  ratingStart: number;
  ratingK: number;
  /** 같은 상대를 이 시간 안에 다시 쓰러뜨리면 점수 없음 */
  repeatCooldownSec: number;
  top: number;
}

export const PVP = pvpJson as PvpConfig;

/** 처치 k, 쓰러짐 d, 점수 r */
export interface PvpRecord {
  k: number;
  d: number;
  r: number;
}

export interface PvpRankRow {
  name: string;
  cls: ClassId;
  lv: number;
  k: number;
  d: number;
  r: number;
}

export function emptyPvp(): PvpRecord {
  return { k: 0, d: 0, r: PVP.ratingStart };
}

/** 이긴 쪽이 얻는(진 쪽이 잃는) 점수: 엘로 방식, 최소 1 */
export function ratingGain(winner: number, loser: number, k = PVP.ratingK): number {
  const expected = 1 / (1 + Math.pow(10, (loser - winner) / 400));
  return Math.max(1, Math.round(k * (1 - expected)));
}

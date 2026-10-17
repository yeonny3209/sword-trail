import type { ChatChannel } from './protocol';
import type { ClassId } from './types';

/** 소셜 서버(전체 채팅·귓속말·파티·길드) 메시지. 존 서버와 따로 연결한다 */

export interface PartyMember {
  id: number;
  name: string;
  cls: ClassId;
  lv: number;
  zone: string;
  online: boolean;
}

export interface GuildMember extends PartyMember {
  /** 0 = 길드원, 1 = 부길드장, 2 = 길드장 */
  rank: number;
}

export interface GuildInfo {
  id: number;
  name: string;
  notice: string;
  members: GuildMember[];
}

export type C2Social =
  | { t: 'chat'; ch: Exclude<ChatChannel, 'zone' | 'system'>; text: string; to?: string }
  /** 내 위치·레벨 알림(목록 표시용) */
  | { t: 'where'; zone: string; lv: number }
  | { t: 'pinvite'; name: string }
  | { t: 'preply'; from: number; ok: boolean }
  | { t: 'pleave' }
  | { t: 'pkick'; id: number }
  | { t: 'ginvite'; name: string }
  | { t: 'greply'; gid: number; ok: boolean }
  | { t: 'gleave' }
  | { t: 'gkick'; id: number }
  | { t: 'gnotice'; text: string }
  | { t: 'ping' };

export type Social2C =
  | { t: 'chat'; ch: ChatChannel; from: string; text: string; to?: string }
  | { t: 'sys'; text: string }
  | { t: 'err'; text: string }
  | { t: 'party'; leader: number; members: PartyMember[] }
  | { t: 'noparty' }
  | { t: 'pinvite'; from: number; name: string }
  | { t: 'guild'; g: GuildInfo }
  | { t: 'noguild' }
  | { t: 'ginvite'; gid: number; gname: string; from: string }
  | { t: 'online'; n: number }
  | { t: 'pong' };

export const MAX_PARTY = 4;
export const MAX_GUILD = 40;
export const GUILD_COST = 2000;
export const GUILD_MIN_LV = 5;
export const GUILD_NAME_RE = /^[가-힣a-zA-Z0-9]{2,10}$/;
/** 파티 경험치를 나누는 거리(m) */
export const PARTY_SHARE_RANGE = 40;

/** 파티원 n명(같은 존·가까이)에게 나누는 경험치: 인원이 많을수록 합계 보너스 */
export function partyExp(total: number, n: number): number {
  if (n <= 1) return total;
  return Math.max(1, Math.round((total * (1 + 0.2 * (n - 1))) / n));
}

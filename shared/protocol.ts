import type { ClassId } from './types';

/** 서버 ↔ 클라이언트 메시지. 형식은 이 파일에만 정의한다. */

export type ChatChannel = 'zone' | 'world' | 'whisper' | 'party' | 'guild' | 'system';

/** 다른 사람에게 보이는 플레이어 정보 */
export interface PlayerInfo {
  id: number;
  name: string;
  cls: ClassId;
  lv: number;
  guild?: string;
  x: number;
  z: number;
  f: number;
  hp: number;
  mhp: number;
}

export interface MonsterInfo {
  id: number;
  kind: string;
  lv: number;
  x: number;
  z: number;
  f: number;
  hp: number;
  mhp: number;
}

/** 내 캐릭터만 아는 정보 */
export interface SelfState {
  id: number;
  name: string;
  cls: ClassId;
  lv: number;
  exp: number;
  gold: number;
  hp: number;
  mhp: number;
  mp: number;
  mmp: number;
  x: number;
  z: number;
}

/** 이동 상태 코드(원격 애니메이션용) */
export enum MoveState {
  Idle = 0,
  Run = 1,
  Dash = 2,
  Air = 3,
  Hit = 4,
  Down = 5,
  Dead = 6,
  Act = 7,
}

export type C2S =
  | { t: 'move'; x: number; z: number; y: number; f: number; st: MoveState }
  | { t: 'act'; a: string; f: number }
  | { t: 'chat'; ch: ChatChannel; text: string; to?: string }
  | { t: 'portal'; id: string }
  | { t: 'ping'; c: number };

export type S2C =
  | { t: 'welcome'; you: SelfState; zone: string; time: number; players: PlayerInfo[]; monsters: MonsterInfo[] }
  /** p: [id, x, z, y, f, st], m: [id, x, z, y, f, st, hp] */
  | { t: 'snap'; time: number; p: number[][]; m: number[][] }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'act'; id: number; a: string; f: number }
  | { t: 'chat'; ch: ChatChannel; from: string; text: string }
  | { t: 'goto'; zone: string }
  | { t: 'pos'; x: number; z: number }
  | { t: 'pong'; c: number; time: number }
  | { t: 'sys'; text: string }
  | { t: 'err'; text: string };

/** REST API */
export interface AuthResponse { token: string; account: string }
export interface CharacterSummary { id: number; name: string; cls: ClassId; lv: number; zone: string }

/** 닉네임 규칙: 한글·영문·숫자 2~12자 */
export const NAME_RE = /^[가-힣a-zA-Z0-9]{2,12}$/;

export const SNAP_HZ = 10;
export const ZONE_HZ = 20;
export const MOVE_SEND_HZ = 10;

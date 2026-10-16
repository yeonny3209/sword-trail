import type { Alloc, StatKey } from './rules';
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
  atk: number;
  def: number;
  crit: number;
  speed: number;
  alloc: Alloc;
  statPoints: number;
  skillPoints: number;
  /** 스킬 id → 레벨(0 = 안 배움) */
  skills: Record<string, number>;
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

/** 몬스터 상태 코드 */
export enum MonState {
  Idle = 0,
  Move = 1,
  Windup = 2,
  Attack = 3,
  Recover = 4,
  Hit = 5,
  Air = 6,
  Down = 7,
  Dead = 8,
}

export type C2S =
  | { t: 'move'; x: number; z: number; y: number; f: number; st: MoveState }
  /** 행동 시작. i: 이 행동의 고유 번호(타격 보고에 씀) */
  | { t: 'act'; a: string; f: number; i: number }
  /** 내가 몬스터(m)를 맞혔다: 행동 번호 i의 h번째 판정 */
  | { t: 'hit'; i: number; h: number; m: number }
  /** 몬스터 m의 k번째 공격에 내가 맞았다 */
  | { t: 'hurt'; m: number; k: number }
  | { t: 'revive' }
  /** 스탯 포인트 1 올리기 */
  | { t: 'stat'; s: StatKey }
  /** 스킬 배우기·레벨 올리기 */
  | { t: 'skill'; a: string }
  /** 스탯·스킬 초기화 */
  | { t: 'reset' }
  | { t: 'chat'; ch: ChatChannel; text: string; to?: string }
  | { t: 'portal'; id: string }
  | { t: 'ping'; c: number };

export type S2C =
  | { t: 'welcome'; you: SelfState; zone: string; time: number; players: PlayerInfo[]; monsters: MonsterInfo[] }
  /** p: [id, x, z, y, f, st, hp], m: [id, x, z, y, f, st, hp] */
  | { t: 'snap'; time: number; p: number[][]; m: number[][] }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'act'; id: number; a: string; f: number }
  /** 피해 숫자. tk: 'm' 몬스터 / 'p' 플레이어 */
  | { t: 'dmg'; tk: 'm' | 'p'; id: number; n: number; crit?: boolean; back?: boolean; counter?: boolean; by: number }
  /** 내 상태 일부 갱신 */
  | { t: 'me'; s: Partial<SelfState> }
  | { t: 'mspawn'; m: MonsterInfo }
  | { t: 'mdie'; id: number; by: number }
  /** 몬스터 공격 시작(예고). k: 공격 번호 */
  | { t: 'matk'; id: number; k: number; f: number }
  /** 다른 플레이어가 맞아서 반응(밀림·띄움) — 보간에 반영되므로 연출용 */
  | { t: 'reward'; exp: number; gold: number; name: string }
  | { t: 'lvup'; id: number; lv: number }
  | { t: 'died'; wait: number }
  | { t: 'cdfail'; a: string }
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

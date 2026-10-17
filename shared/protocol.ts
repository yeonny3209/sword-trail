import type { Alloc, StatKey } from './rules';
import type { ClassId } from './types';
import type { Equip, Item, Slot } from './items';
import type { QuestState } from './quests';
import type { AhCategory, AuctionRow, MailRow, TradeSide } from './market';
import type { PvpRankRow, PvpRecord } from './pvp';

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
  pvp?: PvpRecord;
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
  | { t: 'equip'; uid: string }
  | { t: 'unequip'; slot: Slot }
  | { t: 'use'; uid: string }
  /** 물약 단축키: 1 = HP, 2 = MP */
  | { t: 'pot'; k: 1 | 2 }
  | { t: 'buy'; npc: string; id: string; n: number }
  | { t: 'sell'; uid: string; n: number }
  | { t: 'enhance'; uid: string }
  | { t: 'discard'; uid: string }
  | { t: 'qaccept'; id: string }
  | { t: 'qturnin'; id: string }
  | { t: 'qabandon'; id: string }
  /** 채집 시작·완료(노드 번호) */
  | { t: 'gather'; i: number }
  | { t: 'gatherdone'; i: number }
  | { t: 'craft'; id: string }
  /** 길드 창설(길드 관리인 앞) */
  | { t: 'gcreate'; name: string }
  /** 경매장(경매인 앞): 검색·내 물품·등록·구매·취소 */
  | { t: 'ahsearch'; q: string; cat: AhCategory; page: number }
  | { t: 'ahmine' }
  | { t: 'ahsell'; uid: string; n: number; price: number }
  | { t: 'ahbuy'; id: number }
  | { t: 'ahcancel'; id: number }
  /** 우편함(우체부 앞): 목록·첨부 받기·지우기·보내기 */
  | { t: 'mlist' }
  | { t: 'mtake'; id: number }
  | { t: 'mdel'; id: number }
  | { t: 'msend'; to: string; subject: string; body: string; gold: number; uid?: string; n?: number }
  /** 1:1 거래: 신청·응답·내놓을 것·준비·취소 */
  | { t: 'treq'; id: number }
  | { t: 'tans'; id: number; ok: boolean }
  | { t: 'tset'; items: { uid: string; n: number }[]; gold: number }
  | { t: 'tready'; ok: boolean }
  | { t: 'tcancel' }
  /** 결투장: 내가 플레이어 p를 맞혔다(행동 i의 h번째 판정) */
  | { t: 'phit'; i: number; h: number; p: number }
  /** 결투장: 서버가 알린 공격 k에 내가 맞았다 */
  | { t: 'phurt'; k: number }
  | { t: 'pvprank' }
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
  | { t: 'dmg'; tk: 'm' | 'p'; id: number; n: number; crit?: boolean; back?: boolean; counter?: boolean; by: number; pvp?: boolean }
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
  /** 가방·장비·골드 전체 */
  | { t: 'inv'; inv: Item[]; equip: Equip; gold: number }
  /** 얻은 아이템 알림 */
  | { t: 'loot'; items: { id: string; n: number; rar?: number }[] }
  | { t: 'enh'; ok: boolean; uid: string; enh: number; broke?: boolean }
  | { t: 'quests'; q: QuestState }
  /** 다른 플레이어 정보 변경(길드 등) */
  | { t: 'pinfo'; p: PlayerInfo }
  /** 채집 노드 상태: 지금 쓸 수 없는 노드 번호들 */
  | { t: 'nodes'; down: number[] }
  | { t: 'node'; i: number; up: boolean }
  | { t: 'gathered'; id: string; n: number; lv: number }
  | { t: 'crafted'; id: string; n: number; rar?: number }
  /** 퀘스트 완료 연출 */
  | { t: 'qdone'; id: string }
  /** 경매장 목록(mine: 내 등록 물품). total = -1 이면 목록이 바뀌었으니 다시 검색 */
  | { t: 'ah'; rows: AuctionRow[]; total: number; page: number; mine: boolean }
  | { t: 'mail'; rows: MailRow[] }
  /** 읽지 않은 우편 수 */
  | { t: 'mailnew'; n: number }
  | { t: 'treq'; from: number; name: string }
  /** 거래 창 상태 */
  | { t: 'trade'; name: string; mine: TradeSide; theirs: TradeSide }
  | { t: 'tend'; ok: boolean; text: string }
  /** 결투장: 플레이어 by가 나를 행동 a의 h번째 판정으로 맞혔다(x, z: 공격자 위치). 맞았으면 phurt k로 확인 */
  | { t: 'phit'; k: number; by: number; a: string; h: number; x: number; z: number }
  /** 내 결투장 기록이 바뀜(delta: 점수 변화) */
  | { t: 'pvp'; me: PvpRecord; delta: number }
  | { t: 'pvprank'; me: PvpRecord; top: PvpRankRow[] }
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

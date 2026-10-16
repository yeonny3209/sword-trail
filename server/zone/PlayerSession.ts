import { MoveState, type PlayerInfo, type S2C, type SelfState } from '../../shared/protocol';
import { finalStats, type Stats } from '../../shared/rules';
import { gearBonus } from '../../shared/items';
import type { ClassId } from '../../shared/types';
import { migrateData, type CharData, type CharRow } from '../db';

/** 존에 접속해 있는 플레이어 한 명(서버 쪽 상태) */
export class PlayerSession {
  readonly id: number;
  readonly accountId: number;
  readonly name: string;
  readonly cls: ClassId;
  lv: number;
  data: CharData;
  stats: Stats;
  x: number;
  z: number;
  y = 0;
  f = 0;
  st: MoveState = MoveState.Idle;
  lastMoveAt = Date.now();
  lastChatAt = 0;
  dirty = false;
  /** 포탈로 떠나는 중 */
  leaving = false;
  zone: string;
  dead = false;
  deadAt = 0;
  /** 시작한 행동: 번호 → (행동 id, 시작 시각) */
  readonly acts = new Map<number, { a: string; start: number; hits: Map<string, number> }>();
  /** 스킬 쿨타임: 행동 id → 다시 쓸 수 있는 시각 */
  readonly cds = new Map<string, number>();
  lastHurtAt = 0;
  lastHitAt = 0;
  /** 스킬 돌진으로 허용되는 추가 이동 거리 */
  moveBudget = 0;
  lastPotAt = 0;

  constructor(readonly ws: WebSocket, row: CharRow, zone: string, x: number, z: number) {
    this.id = row.id;
    this.accountId = row.account_id;
    this.name = row.name;
    this.cls = row.class;
    this.lv = row.level;
    this.zone = zone;
    let raw: unknown = null;
    try {
      raw = JSON.parse(row.data);
    } catch {
      raw = null;
    }
    this.data = migrateData(raw, row.class, row.level);
    this.stats = finalStats(row.class, row.level, this.data.alloc, gearBonus(this.data.equip));
    this.data.hp = Math.min(this.data.hp, this.stats.mhp);
    this.data.mp = Math.min(this.data.mp, this.stats.mmp);
    // 쓰러진 채로 나갔다면 바로 부활할 수 있는 상태로 시작
    if (this.data.hp <= 0) this.dead = true;
    this.x = x;
    this.z = z;
  }

  send(msg: S2C): void {
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* 이미 끊김 */
    }
  }

  info(): PlayerInfo {
    return {
      id: this.id, name: this.name, cls: this.cls, lv: this.lv,
      x: this.x, z: this.z, f: this.f, hp: this.data.hp, mhp: this.stats.mhp,
    };
  }

  self(): SelfState {
    return {
      id: this.id, name: this.name, cls: this.cls, lv: this.lv, exp: this.data.exp, gold: this.data.gold,
      hp: this.data.hp, mhp: this.stats.mhp, mp: this.data.mp, mmp: this.stats.mmp, x: this.x, z: this.z,
      atk: this.stats.atk, def: this.stats.def, crit: this.stats.crit, speed: this.stats.speed,
      alloc: { ...this.data.alloc }, statPoints: this.data.statPoints, skillPoints: this.data.skillPoints, skills: { ...this.data.skills },
    };
  }

  /** 레벨이 바뀌면 능력치를 다시 계산 */
  recalc(): void {
    this.stats = finalStats(this.cls, this.lv, this.data.alloc, gearBonus(this.data.equip));
    this.data.hp = Math.min(this.data.hp, this.stats.mhp);
    this.data.mp = Math.min(this.data.mp, this.stats.mmp);
  }

  snap(): number[] {
    const r = (v: number) => Math.round(v * 100) / 100;
    return [this.id, r(this.x), r(this.z), r(this.y), r(this.f), this.st, Math.round(this.data.hp)];
  }
}

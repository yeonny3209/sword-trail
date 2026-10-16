import { MoveState, type PlayerInfo, type S2C, type SelfState } from '../../shared/protocol';
import { baseStats, type Stats } from '../../shared/rules';
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
    this.stats = baseStats(row.class, row.level);
    this.data.hp = Math.min(this.data.hp, this.stats.mhp);
    this.data.mp = Math.min(this.data.mp, this.stats.mmp);
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
    };
  }

  snap(): number[] {
    const r = (v: number) => Math.round(v * 100) / 100;
    return [this.id, r(this.x), r(this.z), r(this.y), r(this.f), this.st];
  }
}

import { MoveState, type PlayerInfo, type S2C, type SelfState } from '../../shared/protocol';
import { BOND, STATUS, type BuffView, type StatusId } from '../../shared/status';
import { finalStats, type Stats } from '../../shared/rules';
import { gearPerks } from '../../shared/gear';
import type { Fx } from '../../shared/perks';
import { ACHS, type AchType } from '../../shared/achievements';
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
  /** 장비·세트·룬·전직의 추가 효과 */
  fx: Fx = {};
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
  /** 채집 중인 노드 */
  gathering: { i: number; start: number } | null = null;
  /** 파티원 id(나 포함, 없으면 빈 배열) — 소셜 DO가 알려 준다 */
  party: number[] = [];
  guild: string | null = null;
  /** 걸려 있는 버프(효과 id → 세기·끝나는 시각·보호막 남은 양) */
  readonly buffs = new Map<StatusId, { power: number; until: number; val: number }>();
  /** 가까이 있는 살아 있는 파티원 수(파티 결속) — 1초마다 갱신 */
  near = 0;
  lastRaiseAt = 0;
  /** 마을 귀환을 시작한 시각(0 = 안 함) */
  recallAt = 0;
  /** 업적 진행 알리기(존 서버가 붙여 줌) */
  achieve: (type: AchType, target?: string, amount?: number) => void = () => {};

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
    const g = gearPerks(this.data.equip, this.data.branch);
    this.fx = g.fx;
    this.stats = finalStats(row.class, row.level, this.data.alloc, g.bonus, g.fx);
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

  /** 버프·파티 결속을 반영한 지금 능력치(공격·방어·치명타·이동 속도) */
  get eff(): Stats {
    const now = Date.now();
    let atk = 1, def = 1, spd = 1, crit = 0;
    for (const [id, b] of this.buffs) {
      if (b.until <= now) continue;
      if (id === 'atkUp') atk += b.power;
      else if (id === 'defUp') def += b.power;
      else if (id === 'speedUp') spd += b.power;
      else if (id === 'critUp') crit += b.power;
    }
    const bond = Math.min(BOND.max, this.near);
    atk += BOND.atk * bond;
    def += BOND.def * bond;
    const s = this.stats;
    return { ...s, atk: Math.round(s.atk * atk), def: Math.round(s.def * def), crit: s.crit + crit, speed: s.speed * spd };
  }

  /** 받는 피해 배율(수호 버프) */
  get damageTaken(): number {
    const g = this.buffs.get('guard');
    return g && g.until > Date.now() ? 1 - g.power : 1;
  }

  /** 효과를 건다(같은 효과는 센 쪽·긴 쪽을 따름). 바뀌었으면 true */
  addBuff(id: StatusId, power: number, durSec: number, val = 0): boolean {
    const until = Date.now() + durSec * 1000;
    const cur = this.buffs.get(id);
    if (cur && cur.until > Date.now()) {
      const stronger = power > cur.power || val > cur.val;
      this.buffs.set(id, { power: Math.max(cur.power, power), until: Math.max(cur.until, until), val: stronger ? val : cur.val });
      return stronger || until > cur.until;
    }
    this.buffs.set(id, { power, until, val });
    return true;
  }

  /** 끝난 버프를 지운다. 지웠으면 true */
  pruneBuffs(now: number): boolean {
    let changed = false;
    for (const [id, b] of this.buffs) {
      if (b.until <= now || (id === 'shield' && b.val <= 0)) {
        this.buffs.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  /** 보호막이 피해를 대신 받는다. 남은 피해를 돌려줌 */
  absorb(n: number): number {
    const sh = this.buffs.get('shield');
    if (!sh || sh.until <= Date.now() || sh.val <= 0) return n;
    const took = Math.min(sh.val, n);
    sh.val -= took;
    return n - took;
  }

  buffViews(): BuffView[] {
    const now = Date.now();
    const out: BuffView[] = [];
    for (const [id, b] of this.buffs) if (b.until > now && STATUS[id]) out.push({ id, left: b.until - now, power: b.power, val: b.val || undefined });
    const bond = Math.min(BOND.max, this.near);
    if (bond > 0) out.push({ id: 'bond', left: 0, power: bond });
    return out;
  }

  /** 버프 목록과 바뀐 능력치를 내게 알린다 */
  sendBuffs(): void {
    this.send({ t: 'buffs', list: this.buffViews() });
    const e = this.eff;
    this.send({ t: 'me', s: { atk: e.atk, def: e.def, crit: e.crit, speed: e.speed } });
  }

  info(): PlayerInfo {
    return {
      id: this.id, name: this.name, cls: this.cls, lv: this.lv,
      x: this.x, z: this.z, f: this.f, hp: this.data.hp, mhp: this.stats.mhp, guild: this.guild ?? undefined,
      title: ACHS[this.data.title]?.title,
    };
  }

  self(): SelfState {
    return {
      id: this.id, name: this.name, cls: this.cls, lv: this.lv, exp: this.data.exp, gold: this.data.gold,
      hp: this.data.hp, mhp: this.stats.mhp, mp: this.data.mp, mmp: this.stats.mmp, x: this.x, z: this.z,
      atk: this.eff.atk, def: this.eff.def, crit: this.eff.crit, speed: this.eff.speed,
      alloc: { ...this.data.alloc }, statPoints: this.data.statPoints, skillPoints: this.data.skillPoints, skills: { ...this.data.skills },
      pvp: { ...this.data.pvp },
      branch: this.data.branch || undefined, senh: { ...this.data.senh }, fx: { ...this.fx },
    };
  }

  /** 레벨이 바뀌면 능력치를 다시 계산 */
  recalc(): void {
    const g = gearPerks(this.data.equip, this.data.branch);
    this.fx = g.fx;
    this.stats = finalStats(this.cls, this.lv, this.data.alloc, g.bonus, g.fx);
    this.data.hp = Math.min(this.data.hp, this.stats.mhp);
    this.data.mp = Math.min(this.data.mp, this.stats.mmp);
  }

  snap(): number[] {
    const r = (v: number) => Math.round(v * 100) / 100;
    // 쓰러져 있으면 다른 사람 화면에서도 누워 있게(쓰러진 파티원을 찾아 살릴 수 있도록)
    return [this.id, r(this.x), r(this.z), r(this.y), r(this.f), this.dead ? MoveState.Dead : this.st, Math.round(this.data.hp)];
  }
}

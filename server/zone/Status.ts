import { dist2, shapeHits } from '../../shared/geom';
import type { S2C } from '../../shared/protocol';
import { BOND, BOSS_DEBUFF_RATE, castScale, type StatusApply } from '../../shared/status';
import type { ActionDef, Cast } from '../../shared/types';
import type { Combat } from './Combat';
import type { Monster } from './Monster';
import type { PlayerSession } from './PlayerSession';

export interface StatusHost {
  players: Map<number, PlayerSession>;
  monsters: Map<number, Monster>;
  broadcast(m: S2C, except?: PlayerSession): void;
  combat: Combat;
}

/** 이 효과의 최대 세기(너무 세지지 않게) */
const CAP: Partial<Record<StatusApply['id'], number>> = { guard: 0.6, speedUp: 0.6, atkUp: 1.5, defUp: 1.5, critUp: 0.4, slow: 0.8, atkDown: 0.6, defDown: 0.7, vuln: 0.6 };

interface Pending {
  at: number;
  p: PlayerSession;
  cast: Cast;
  slv: number;
  /** 시전 순간 바라보던 방향·위치(적 범위 판정용) */
  x: number;
  z: number;
  f: number;
}

/**
 * 스킬 효과(치유·버프·디버프·소생)와 상태효과의 시간 흐름.
 * 시전 프레임이 되면 적용하고, 1초마다 지속 회복·독·끝난 효과 정리·파티 결속을 처리한다.
 */
export class StatusSystem {
  private readonly pending: Pending[] = [];
  private lastTick = Date.now();

  constructor(private readonly h: StatusHost) {}

  /** 스킬을 쓰면: cast 프레임에 적용하도록 예약 */
  schedule(p: PlayerSession, a: ActionDef, slv: number): void {
    if (!a.cast) return;
    this.pending.push({ at: Date.now() + (a.cast.at / 60) * 1000, p, cast: a.cast, slv, x: p.x, z: p.z, f: p.f });
  }

  /** 20Hz */
  update(now: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const q = this.pending[i];
      if (q.at > now) continue;
      this.pending.splice(i, 1);
      if (!q.p.dead && !q.p.leaving && this.h.players.get(q.p.id) === q.p) this.apply(q);
    }
    if (now - this.lastTick >= 1000) {
      this.lastTick = now;
      this.tick(now);
    }
  }

  // ───────── 효과 적용 ─────────
  private allies(p: PlayerSession, range: number, selfOnly?: boolean): PlayerSession[] {
    const out = [p];
    if (selfOnly) return out;
    for (const id of p.party) {
      const q = this.h.players.get(id);
      if (q && q !== p && !q.dead && !q.leaving && dist2(p.x, p.z, q.x, q.z) <= range * range) out.push(q);
    }
    return out;
  }

  private apply(q: Pending): void {
    const { p, cast, slv } = q;
    const k = castScale(slv);
    const ids: number[] = [];
    const mids: number[] = [];
    let kind: 'heal' | 'buff' | 'debuff' | 'revive' = 'buff';
    const ally = cast.ally;
    if (ally) {
      if (ally.revive) {
        const t = this.deadAlly(p, ally.range);
        if (t) {
          this.revive(t, Math.min(1, ally.revive * k), p.name);
          ids.push(t.id);
          kind = 'revive';
        }
      }
      for (const a of this.allies(p, ally.range, ally.selfOnly)) {
        let changed = false;
        if (ally.heal) {
          const n = Math.round(a.stats.mhp * Math.min(1, ally.heal * k));
          if (n > 0 && a.data.hp < a.stats.mhp) {
            a.data.hp = Math.min(a.stats.mhp, a.data.hp + n);
            a.dirty = true;
            a.send({ t: 'me', s: { hp: Math.round(a.data.hp) } });
            this.h.broadcast({ t: 'heal', id: a.id, n, by: p.id });
            kind = 'heal';
            ids.push(a.id);
          }
        }
        for (const b of ally.buffs ?? []) {
          const power = Math.min(CAP[b.id] ?? 2, b.power * k);
          const val = b.id === 'shield' ? Math.round(a.stats.mhp * power) : 0;
          if (a.addBuff(b.id, power, b.dur, val)) changed = true;
          if (!ids.includes(a.id)) ids.push(a.id);
        }
        if (changed) a.sendBuffs();
      }
    }
    if (cast.foe) {
      const pos = { x: q.x, z: q.z };
      for (const m of this.h.monsters.values()) {
        if (m.dead || !shapeHits(cast.foe.shape, pos.x, pos.z, q.f, m.body.x, m.body.z, m.def.radius, m.body.y)) continue;
        if (this.debuff(m, cast.foe.debuffs, p, k)) mids.push(m.id);
      }
      if (mids.length) kind = 'debuff';
    }
    if (ids.length || mids.length) this.h.broadcast({ t: 'cast', by: p.id, kind, ids, mids, color: cast.color });
  }

  /** 몬스터에게 디버프. 하나라도 걸렸으면 true */
  private debuff(m: Monster, list: StatusApply[], by: PlayerSession, k: number): boolean {
    let any = false;
    for (const d of list) {
      if (m.def.boss && d.id === 'bind') continue;
      const rate = m.def.boss ? BOSS_DEBUFF_RATE : 1;
      const power = Math.min(CAP[d.id] ?? 2, d.power * k) * (d.id === 'poison' ? 1 : rate);
      // 독은 시전자의 공격력에 비례한 초당 피해
      const val = d.id === 'poison' ? Math.max(1, Math.round(by.eff.atk * power * 0.25)) : 0;
      if (m.addStatus(d.id, power, d.dur, by.id, val)) any = true;
      else any = true;
    }
    this.h.broadcast({ t: 'mstatus', id: m.id, s: [...m.status.keys()] });
    return any;
  }

  // ───────── 소생 ─────────
  deadAlly(p: PlayerSession, range: number): PlayerSession | null {
    let best: PlayerSession | null = null, bd = range * range;
    for (const id of p.party) {
      const t = this.h.players.get(id);
      if (!t || t === p || !t.dead || t.leaving) continue;
      const d = dist2(p.x, p.z, t.x, t.z);
      if (d <= bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /** 쓰러진 사람을 그 자리에서 hpFrac 체력으로 일으킨다 */
  revive(t: PlayerSession, hpFrac: number, byName: string): void {
    t.dead = false;
    t.data.hp = Math.max(1, Math.round(t.stats.mhp * hpFrac));
    t.dirty = true;
    t.send({ t: 'pos', x: t.x, z: t.z });
    t.send({ t: 'me', s: { hp: t.data.hp } });
    t.send({ t: 'sys', text: `${byName}님이 당신을 살려 주었습니다!` });
    this.h.broadcast({ t: 'sys', text: `${byName}님이 ${t.name}님을 살렸습니다.` });
  }

  /** 아무나 쓰러진 파티원 곁에서 스페이스로 일으킨다(재사용 시간 있음) */
  raise(p: PlayerSession, targetId: number): void {
    const t = this.h.players.get(targetId);
    if (!t || t === p || !t.dead || p.dead || !p.party.includes(t.id)) return;
    if (dist2(p.x, p.z, t.x, t.z) > 5 * 5) return p.send({ t: 'err', text: '조금 더 가까이 가야 살릴 수 있습니다.' });
    const now = Date.now();
    if (now - p.lastRaiseAt < 8000) return p.send({ t: 'err', text: '아직 다시 살릴 수 없습니다.' });
    p.lastRaiseAt = now;
    this.revive(t, 0.35, p.name);
  }

  // ───────── 1초마다 ─────────
  private tick(now: number): void {
    for (const p of this.h.players.values()) {
      if (p.leaving) continue;
      // 파티 결속: 가까이 있는 살아 있는 파티원 수
      let near = 0;
      if (!p.dead) {
        for (const id of p.party) {
          const q = this.h.players.get(id);
          if (q && q !== p && !q.dead && !q.leaving && dist2(p.x, p.z, q.x, q.z) <= BOND.range * BOND.range) near++;
        }
      }
      const bondChanged = near !== p.near;
      p.near = near;
      let changed = p.pruneBuffs(now) || bondChanged;
      if (!p.dead) {
        const rg = p.buffs.get('regen');
        if (rg && p.data.hp < p.stats.mhp) {
          p.data.hp = Math.min(p.stats.mhp, p.data.hp + p.stats.mhp * rg.power);
          p.dirty = true;
          p.send({ t: 'me', s: { hp: Math.round(p.data.hp) } });
        }
        const mr = p.buffs.get('mpRegen');
        if (mr && p.data.mp < p.stats.mmp) {
          p.data.mp = Math.min(p.stats.mmp, p.data.mp + p.stats.mmp * mr.power);
          p.send({ t: 'me', s: { mp: Math.round(p.data.mp) } });
        }
      }
      if (changed) p.sendBuffs();
      changed = false;
    }
    for (const m of this.h.monsters.values()) {
      if (m.dead || !m.status.size) continue;
      const poison = m.status.get('poison');
      if (poison && poison.until > now && poison.val > 0) this.h.combat.dot(m, poison.val, poison.by);
      if (m.pruneStatus(now)) this.h.broadcast({ t: 'mstatus', id: m.id, s: [...m.status.keys()] });
    }
  }
}

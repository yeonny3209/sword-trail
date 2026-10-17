import { rollDamage } from '../../shared/combat';
import { actionOf, isSkill } from '../../shared/data';
import { dist2 } from '../../shared/geom';
import { MoveState, type C2S, type S2C } from '../../shared/protocol';
import { PVP, ratingGain, type PvpRankRow } from '../../shared/pvp';
import { skillMul } from '../../shared/rules';
import type { ClassId, ZoneDef } from '../../shared/types';
import type { Env } from '../env';
import type { Combat } from './Combat';
import type { PlayerSession } from './PlayerSession';

export interface PvpHost {
  env: Env;
  zone: ZoneDef;
  players: Map<number, PlayerSession>;
  combat: Combat;
  broadcast(msg: S2C, except?: PlayerSession): void;
}

const SLACK = 3;
const PLAYER_R = 0.45;
const CONFIRM_MS = 2500;

interface Pending {
  att: number;
  vic: number;
  mult: number;
  at: number;
}

/**
 * 결투장 PvP. 공격자가 맞힘을 보고하면 서버가 검사해서 맞은 사람에게 알리고,
 * 맞은 사람의 클라이언트가 피격을 확인하면(무적·회피는 그쪽이 판단) 피해를 계산한다.
 */
export class PvpSystem {
  private readonly pending = new Map<number, Pending>();
  private seq = 1;
  /** 같은 상대 반복 처치: "공격자:상대" → 시각 */
  private readonly lastKill = new Map<string, number>();

  constructor(private readonly h: PvpHost) {}

  onHit(p: PlayerSession, m: Extract<C2S, { t: 'phit' }>): void {
    const v = this.h.players.get(m.p | 0);
    if (!this.h.zone.pvp || !v || v === p || p.dead || v.dead || v.leaving) return;
    if (p.party.includes(v.id)) return;
    if (v.st === MoveState.Down || v.st === MoveState.Dead) return;
    const act = p.acts.get(m.i | 0);
    const a = act && actionOf(p.cls, act.a);
    const hit = a?.hits[m.h | 0];
    if (!act || !a || !hit) return;
    const now = Date.now();
    if (now - act.start > (hit.f[1] / 60) * 1000 + 1500) return;
    const key = `${m.h | 0}:p${v.id}`;
    const count = act.hits.get(key) ?? 0;
    const maxHits = hit.multi ? Math.floor((hit.f[1] - hit.f[0]) / hit.multi) + 1 : 1;
    if (count >= maxHits) return;
    act.hits.set(key, count + 1);
    const reach = hit.shape.range + (hit.shape.offset ?? 0) + PLAYER_R + SLACK;
    if (dist2(p.x, p.z, v.x, v.z) > reach * reach) return;
    if (this.invulnerable(v, now)) return;
    const mult = hit.dmg * (isSkill(p.cls, a.id) ? skillMul(p.data.skills[a.id] ?? 1) : 1);
    const k = this.seq++;
    this.pending.set(k, { att: p.id, vic: v.id, mult, at: now });
    if (this.pending.size > 300) {
      for (const [id, pd] of this.pending) if (now - pd.at > CONFIRM_MS) this.pending.delete(id);
    }
    p.lastHitAt = now;
    v.send({ t: 'phit', k, by: p.id, a: a.id, h: m.h | 0, x: p.x, z: p.z });
  }

  /** 서버가 아는 무적: 최근 행동의 무적 프레임(백스텝 등) */
  private invulnerable(v: PlayerSession, now: number): boolean {
    let last: { a: string; start: number } | undefined;
    for (const x of v.acts.values()) last = x;
    const inv = last && actionOf(v.cls, last.a)?.invul;
    if (!last || !inv) return false;
    const f = ((now - last.start) / 1000) * 60;
    return f >= inv[0] - 2 && f <= inv[1] + 4;
  }

  /** 맞은 사람이 피격을 확인했다 */
  onHurt(v: PlayerSession, m: Extract<C2S, { t: 'phurt' }>): void {
    const pd = this.pending.get(m.k | 0);
    this.pending.delete(m.k | 0);
    if (!pd || pd.vic !== v.id || Date.now() - pd.at > CONFIRM_MS || v.dead) return;
    const p = this.h.players.get(pd.att);
    if (!p) return;
    const crit = Math.random() < p.eff.crit;
    const n = Math.max(1, Math.round(rollDamage(p.eff.atk, pd.mult, v.eff.def, Math.random(), { crit, critMul: 1.5, back: false, counter: false }) * PVP.damageScale));
    this.h.combat.damagePlayer(v, n, p.id, { crit, pvp: true });
    if (v.dead) this.onKill(p, v);
  }

  private onKill(p: PlayerSession, v: PlayerSession): void {
    const now = Date.now();
    const key = `${p.id}:${v.id}`;
    const repeat = now - (this.lastKill.get(key) ?? 0) < PVP.repeatCooldownSec * 1000;
    this.lastKill.set(key, now);
    const gain = repeat ? 0 : ratingGain(p.data.pvp.r, v.data.pvp.r);
    p.data.pvp.k++;
    p.data.pvp.r += gain;
    v.data.pvp.d++;
    v.data.pvp.r = Math.max(0, v.data.pvp.r - gain);
    p.dirty = v.dirty = true;
    p.send({ t: 'pvp', me: p.data.pvp, delta: gain });
    if (!repeat) p.achieve('pvp');
    v.send({ t: 'pvp', me: v.data.pvp, delta: -gain });
    this.h.broadcast({ t: 'sys', text: `⚔ ${p.name}님이 ${v.name}님을 쓰러뜨렸습니다!${gain ? ` (점수 +${gain})` : ' (같은 상대 반복: 점수 없음)'}` });
  }

  /** 순위표(점수 순) */
  async onRank(p: PlayerSession): Promise<void> {
    const { results } = await this.h.env.DB.prepare(
      `SELECT name, class, level, json_extract(data, '$.pvp.k') AS k, json_extract(data, '$.pvp.d') AS d, json_extract(data, '$.pvp.r') AS r
       FROM characters WHERE json_extract(data, '$.pvp.k') > 0 OR json_extract(data, '$.pvp.d') > 0 ORDER BY r DESC, k DESC LIMIT ?`,
    ).bind(PVP.top).all<{ name: string; class: ClassId; level: number; k: number; d: number; r: number }>();
    const top: PvpRankRow[] = results.map((r) => ({ name: r.name, cls: r.class, lv: r.level, k: r.k ?? 0, d: r.d ?? 0, r: r.r ?? PVP.ratingStart }));
    p.send({ t: 'pvprank', me: p.data.pvp, top });
  }
}

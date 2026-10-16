import { applyReaction, expFactor, isBackAttack, rollDamage } from '../../shared/combat';
import { actionOf, isSkill } from '../../shared/data';
import { dist2 } from '../../shared/geom';
import { MonState, type C2S, type S2C } from '../../shared/protocol';
import { actionTravel, expToNext, MAX_LEVEL, SKILL_POINTS_PER_LEVEL, skillMp, skillMul, STAT_POINTS_PER_LEVEL } from '../../shared/rules';
import type { ZoneDef } from '../../shared/types';
import type { Monster } from './Monster';
import type { PlayerSession } from './PlayerSession';
import { rollLoot } from './Inventory';

/** 존 DO가 전투에 넘겨주는 기능 */
export interface CombatHost {
  zone: ZoneDef;
  monsters: Map<number, Monster>;
  broadcast(msg: S2C, except?: PlayerSession): void;
  /** 처치 알림(퀘스트 진행) */
  onKill(p: PlayerSession, monsterId: string): void;
}

const SLACK_RANGE = 3;
const REVIVE_WAIT = 5;

/**
 * 전투 검증과 계산(서버 권한). 타격은 클라이언트가 보고하고 서버가 거리·시간·비용을 확인한 뒤 피해를 정한다.
 */
export class Combat {
  constructor(private readonly host: CombatHost) {}

  onAct(p: PlayerSession, m: Extract<C2S, { t: 'act' }>): void {
    if (p.dead) return;
    const a = actionOf(p.cls, String(m.a));
    if (!a) return;
    const now = Date.now();
    if (isSkill(p.cls, a.id)) {
      const slv = p.data.skills[a.id] ?? 0;
      const cost = skillMp(a, slv);
      const ready = p.cds.get(a.id) ?? 0;
      if (slv < 1 || now < ready - 150 || p.data.mp + 0.5 < cost) {
        p.send({ t: 'cdfail', a: a.id });
        return;
      }
      p.data.mp -= cost;
      p.cds.set(a.id, now + (a.cd ?? 0) * 1000);
      p.send({ t: 'me', s: { mp: p.data.mp } });
    }
    p.moveBudget = Math.min(30, p.moveBudget + actionTravel(a) * 1.3 + 1);
    p.acts.set(m.i | 0, { a: a.id, start: now, hits: new Map() });
    if (p.acts.size > 24) p.acts.delete(p.acts.keys().next().value!);
    this.host.broadcast({ t: 'act', id: p.id, a: a.id, f: Number(m.f) || 0 }, p);
  }

  onHit(p: PlayerSession, m: Extract<C2S, { t: 'hit' }>): void {
    if (p.dead) return;
    const act = p.acts.get(m.i | 0);
    const mon = this.host.monsters.get(m.m | 0);
    if (!act || !mon || mon.dead) return;
    const a = actionOf(p.cls, act.a);
    const hit = a?.hits[m.h | 0];
    if (!a || !hit) return;
    const now = Date.now();
    // 시간: 판정 끝 프레임 + 지연 여유
    if (now - act.start > (hit.f[1] / 60) * 1000 + 1500) return;
    // 같은 판정으로 같은 대상은 한 번(연타 판정은 정해진 횟수만큼)
    const key = `${m.h}:${mon.id}`;
    const count = act.hits.get(key) ?? 0;
    const maxHits = hit.multi ? Math.floor((hit.f[1] - hit.f[0]) / hit.multi) + 1 : 1;
    if (count >= maxHits) return;
    act.hits.set(key, count + 1);
    // 거리: 서버 위치 기준으로 판정 범위 + 여유
    const reach = hit.shape.range + (hit.shape.offset ?? 0) + mon.def.radius + SLACK_RANGE;
    if (dist2(p.x, p.z, mon.body.x, mon.body.z) > reach * reach) return;

    const crit = Math.random() < p.stats.crit;
    const back = !mon.def.boss && isBackAttack(mon.f, p.x, p.z, mon.body.x, mon.body.z);
    const counter = mon.state === MonState.Windup || mon.state === MonState.Attack;
    const mult = hit.dmg * (isSkill(p.cls, a.id) ? skillMul(p.data.skills[a.id] ?? 1) : 1);
    const n = rollDamage(p.stats.atk, mult, mon.def.def, Math.random(), { crit, critMul: 1.5, back, counter });
    mon.hp -= n;
    mon.lastAttacker = p.id;
    mon.target = p;
    // 밀어내는 방향: 찌르기·직선은 내가 바라보는 쪽, 그 외는 나 → 대상
    const dir = hit.shape.type === 'box' ? [Math.sin(p.f), Math.cos(p.f)] : [mon.body.x - p.x, mon.body.z - p.z];
    applyReaction(mon.body, hit, dir[0], dir[1], mon.def.weight, mon.def.superArmor);
    mon.interrupt();
    if (hit.mp) p.data.mp = Math.min(p.stats.mmp, p.data.mp + hit.mp);
    p.lastHitAt = now;
    this.host.broadcast({ t: 'dmg', tk: 'm', id: mon.id, n, crit, back, counter, by: p.id });
    if (mon.hp <= 0) this.kill(mon, p);
  }

  private kill(mon: Monster, killer: PlayerSession): void {
    mon.dead = true;
    mon.state = MonState.Dead;
    mon.respawnT = mon.def.respawn;
    mon.window = null;
    this.host.broadcast({ t: 'mdie', id: mon.id, by: killer.id });
    const exp = Math.max(1, Math.round(mon.def.exp * expFactor(killer.lv, mon.def.lv)));
    const [g0, g1] = mon.def.gold;
    const gold = g0 + Math.floor(Math.random() * (g1 - g0 + 1));
    killer.data.gold += gold;
    killer.send({ t: 'reward', exp, gold, name: mon.def.name });
    this.gainExp(killer, exp);
    rollLoot(killer, mon.def);
    this.host.onKill(killer, mon.def.id);
  }

  gainExp(p: PlayerSession, exp: number): void {
    p.data.exp += exp;
    let leveled = false;
    while (p.lv < MAX_LEVEL && p.data.exp >= expToNext(p.lv)) {
      p.data.exp -= expToNext(p.lv);
      p.lv++;
      p.data.statPoints += STAT_POINTS_PER_LEVEL;
      p.data.skillPoints += SKILL_POINTS_PER_LEVEL;
      leveled = true;
    }
    if (leveled) {
      p.recalc();
      p.data.hp = p.stats.mhp;
      p.send({ t: 'sys', text: `레벨 ${p.lv}! 스탯 포인트 ${STAT_POINTS_PER_LEVEL}, 스킬 포인트 ${SKILL_POINTS_PER_LEVEL}을 얻었습니다. (U: 캐릭터, K: 스킬)` });
      p.data.mp = p.stats.mmp;
      this.host.broadcast({ t: 'lvup', id: p.id, lv: p.lv });
      p.send({ t: 'me', s: p.self() });
    } else {
      p.send({ t: 'me', s: { exp: p.data.exp, gold: p.data.gold, mp: p.data.mp } });
    }
    p.dirty = true;
  }

  onHurt(p: PlayerSession, m: Extract<C2S, { t: 'hurt' }>): void {
    if (p.dead) return;
    const mon = this.host.monsters.get(m.m | 0);
    const w = mon?.window;
    if (!mon || !w || w.k !== (m.k | 0) || w.hurt.has(p.id)) return;
    const now = Date.now();
    if (now < w.activeStart - 400 || now > w.activeEnd + 900) return;
    const a = mon.def.attacks[w.k];
    const reach = a.range + (a.lunge ?? 0) * a.active + mon.def.radius + SLACK_RANGE;
    if (dist2(p.x, p.z, mon.body.x, mon.body.z) > reach * reach) return;
    w.hurt.add(p.id);
    const n = rollDamage(mon.def.atk, a.dmg, p.stats.def, Math.random(), { crit: false, critMul: 1, back: false, counter: false });
    this.damagePlayer(p, n, mon.id);
  }

  damagePlayer(p: PlayerSession, n: number, by: number): void {
    p.gathering = null;
    p.data.hp = Math.max(0, p.data.hp - n);
    p.lastHurtAt = Date.now();
    p.dirty = true;
    this.host.broadcast({ t: 'dmg', tk: 'p', id: p.id, n, by });
    p.send({ t: 'me', s: { hp: p.data.hp } });
    if (p.data.hp <= 0) {
      p.dead = true;
      p.deadAt = Date.now();
      p.send({ t: 'died', wait: REVIVE_WAIT });
      this.host.broadcast({ t: 'sys', text: `${p.name}님이 쓰러졌습니다.` });
    }
  }

  /** 부활: 존 입구에서 체력 절반으로 */
  onRevive(p: PlayerSession): void {
    if (!p.dead || Date.now() - p.deadAt < REVIVE_WAIT * 1000 - 300) return;
    p.dead = false;
    p.data.hp = Math.round(p.stats.mhp * 0.5);
    p.data.mp = Math.max(p.data.mp, Math.round(p.stats.mmp * 0.5));
    p.x = this.host.zone.spawn[0];
    p.z = this.host.zone.spawn[1];
    p.send({ t: 'pos', x: p.x, z: p.z });
    p.send({ t: 'me', s: { hp: p.data.hp, mp: p.data.mp } });
  }

  /** 1초마다: MP 자연 회복, 전투에서 벗어나면 HP 회복 */
  regen(p: PlayerSession): void {
    if (p.dead) return;
    const now = Date.now();
    const s = p.stats, d = p.data;
    const before = [d.hp, d.mp];
    d.mp = Math.min(s.mmp, d.mp + Math.max(2, s.mmp * 0.025));
    if (now - p.lastHurtAt > 6000 && now - p.lastHitAt > 4000) d.hp = Math.min(s.mhp, d.hp + s.mhp * 0.03);
    if (d.hp !== before[0] || d.mp !== before[1]) p.send({ t: 'me', s: { hp: Math.round(d.hp), mp: Math.round(d.mp) } });
  }
}

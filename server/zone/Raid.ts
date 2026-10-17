import { MONSTERS } from '../../shared/data';
import { ITEMS, makeItem, rollRarity, type Item } from '../../shared/items';
import type { S2C } from '../../shared/protocol';
import { RAID, raidHp } from '../../shared/raid';
import { expBoost, PROGRESSION } from '../../shared/rules';
import type { MonsterDef, ZoneDef } from '../../shared/types';
import { newUid } from '../db';
import { addItem, syncInv } from './Inventory';
import type { Monster } from './Monster';
import type { PlayerSession } from './PlayerSession';

export interface RaidHost {
  zone: ZoneDef;
  players: Map<number, PlayerSession>;
  broadcast(m: S2C, except?: PlayerSession): void;
  /** 몬스터를 새로 불러낸다(부하 소환) */
  spawn(def: MonsterDef, x: number, z: number): Monster;
  gainExp(p: PlayerSession, exp: number): void;
  onKill(p: PlayerSession, monsterId: string): void;
  /** 가방이 가득 차서 못 넣은 보상은 우편으로 */
  mailItem(p: PlayerSession, it: Item, subject: string): Promise<void>;
  save(p: PlayerSession): Promise<void>;
}

/**
 * 레이드 던전의 보스 진행: 입장 인원에 맞춘 체력, 체력 단계마다 부하 소환, 오래 끌면 격노, 처치 보상.
 * 보스를 처음 때리기 전까지만 체력을 인원에 맞춰 다시 정한다.
 */
export class RaidSystem {
  private boss: Monster | null = null;
  private phase = 0;
  private startedAt = 0;
  private enraged = false;
  cleared = false;

  constructor(private readonly h: RaidHost) {}

  bind(boss: Monster): void {
    this.boss = boss;
  }

  /** 입장·퇴장으로 인원이 바뀌었다: 아직 안 싸웠으면 체력을 다시 맞춤 */
  scale(n: number, except?: PlayerSession): void {
    const b = this.boss;
    if (!b || this.startedAt || b.dead || n < 1) return;
    b.mhp = raidHp(b.def.hp, n);
    b.hp = b.mhp;
    this.h.broadcast({ t: 'mspawn', m: b.info() }, except);
  }

  /** 20Hz */
  update(now: number): void {
    const b = this.boss;
    if (!b || b.dead || this.cleared) return;
    if (!this.startedAt) {
      if (b.hp >= b.mhp) return;
      this.startedAt = now;
      this.h.broadcast({ t: 'banner', text: `${b.def.name}이(가) 깨어났다!`, kind: 'warn' });
    }
    const cfg = b.def.raid!;
    while (this.phase < cfg.phases.length && b.hp / b.mhp <= cfg.phases[this.phase]) {
      this.phase++;
      this.enterPhase(b);
    }
    if (!this.enraged && now - this.startedAt > cfg.enrageSec * 1000) {
      this.enraged = true;
      b.atkMul *= 1.5;
      b.speedMul *= 1.25;
      b.cdMul *= 0.7;
      this.h.broadcast({ t: 'banner', text: '시간이 너무 오래 걸렸다… 보스가 격노했다!', kind: 'warn' });
    }
  }

  /** 체력 단계: 부하를 불러내고 보스가 조금 빨라진다 */
  private enterPhase(b: Monster): void {
    const cfg = b.def.raid!;
    const def = MONSTERS[cfg.adds];
    b.speedMul += 0.08;
    b.cdMul *= 0.92;
    this.h.broadcast({ t: 'banner', text: `${this.phase}단계! 성채 수호병이 몰려온다!`, kind: 'warn' });
    if (!def) return;
    const alive = [...this.h.players.values()].filter((p) => !p.dead && !p.leaving).length;
    const n = Math.max(2, Math.min(8, alive * cfg.addsPerPlayer));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const m = this.h.spawn(def, b.body.x + Math.sin(a) * 7, b.body.z + Math.cos(a) * 7);
      m.summoned = true;
    }
  }

  /** 보스 처치: 한 번이라도 피해를 준 모두에게 보상 */
  clear(boss: Monster): void {
    this.cleared = true;
    this.h.broadcast({ t: 'banner', text: '레이드 클리어!', kind: 'good' });
    const def = boss.def;
    for (const p of this.h.players.values()) {
      if (!boss.dealt.has(p.id) || p.leaving) continue;
      const [g0, g1] = def.gold;
      const gold = g0 + Math.floor(Math.random() * (g1 - g0 + 1));
      p.data.gold += gold;
      const exp = Math.round(def.exp * PROGRESSION.monsterExpRate * expBoost(p.lv));
      p.send({ t: 'reward', exp, gold, name: def.name });
      this.h.gainExp(p, exp);
      this.h.onKill(p, def.id);
      const items = this.rewards(p, def);
      const got: { id: string; n: number; rar?: number }[] = [];
      for (const it of items) {
        if (addItem(p, it) > 0) void this.h.mailItem(p, it, '레이드 보상(가방이 가득 차서 우편으로 보냅니다)');
        else got.push({ id: it.id, n: it.n, rar: it.rar });
      }
      if (got.length) p.send({ t: 'loot', items: got });
      syncInv(p);
      void this.h.save(p);
    }
  }

  /** 보상: 반드시 장비 하나(높은 등급이 잘 나옴) + 재료 */
  private rewards(p: PlayerSession, def: MonsterDef): Item[] {
    const out: Item[] = [];
    const pool = Object.values(ITEMS).filter((d) => d.kind === 'equip' && d.lv <= def.lv + 2 && d.lv >= def.lv - 14 && (!d.cls || d.cls === p.cls || Math.random() < 0.3));
    const d = pool[Math.floor(Math.random() * pool.length)];
    if (d) out.push(makeItem(d.id, 1, newUid(), Math.max(RAID.minRarity, rollRarity(Math.random(), RAID.rewardRarityBonus))));
    for (const m of RAID.mats) {
      const n = m.n[0] + Math.floor(Math.random() * (m.n[1] - m.n[0] + 1));
      if (ITEMS[m.item] && n > 0) out.push(makeItem(m.item, n, newUid()));
    }
    return out;
  }
}

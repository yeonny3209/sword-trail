import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { RewardOption } from '../core/events';
import { defaultMods, type AttackData, type Modifiers, type ProjectileSpec } from '../combat/types';
import type { Progression } from './Progression';

export interface EngravingDef {
  id: string;
  name: string;
  tags: string[];
  rarity: 'common' | 'rare';
  desc: string;
  projectile?: ProjectileSpec;
  damage?: number;
  posture?: number;
  heal?: number;
  count?: number;
  window?: number;
  seconds?: number;
  attackSpeed?: number;
  mul?: number;
  stamina?: number;
  staminaRegenMul?: number;
  heavyDamageMul?: number;
  postureMul?: number;
  damageMul?: number;
  maxHpMul?: number;
  threshold?: number;
  maxHp?: number;
  blockCostMul?: number;
  damageTakenMul?: number;
}

type TagBonus = Partial<Record<keyof Modifiers, number>> & { desc: string };

/**
 * 런 안의 성장: 각인. 방을 깰 때마다 3개 중 1개를 고른다.
 * 효과는 모두 이벤트 구독으로 구현해서, 새 각인을 추가해도 전투 코드는 바뀌지 않는다.
 * 같은 꼬리표 3개를 모으면 꼬리표 보너스가 붙는다.
 */
export class Engravings {
  private readonly data = getData<{ list: EngravingDef[]; tagBonuses: Record<string, TagBonus> }>('engravings');
  private readonly choices = getData<{ rewardChoices: number; tagBonusCount: number }>('progression');
  owned: EngravingDef[] = [];
  private offering = false;
  // 조건부 효과 상태
  private dodgeCrit = 0;
  private haste = 0;
  private rage = false;
  private buffTime = 0;
  private buffParry = 0;
  private buffSpeed = 0;
  private parryTimes: number[] = [];
  private time = 0;

  constructor(private readonly prog: Progression) {
    bus.on('runStarted', () => {
      this.clear();
      if (prog.level('start_engraving') > 0) this.offer('출발 전, 검의 기억 하나를 새긴다', false);
    });
    bus.on('returnToCamp', () => this.clear());
    bus.on('roomCleared', (e) => {
      if (e.type === 'combat') this.offer('각인을 하나 고른다', false);
      else if (e.type === 'elite') this.offer('정예를 쓰러뜨렸다 — 희귀한 각인', true);
    });
    bus.on('rewardChosen', ({ id }) => {
      if (!this.offering) return;
      const def = this.data.list.find((x) => x.id === id);
      if (!def) return;
      this.offering = false;
      this.owned.push(def);
      bus.emit('engravingGained', { id: def.id, name: def.name, tags: def.tags });
      this.recompute(true);
    });
    this.listenEffects();
  }

  has(id: string): EngravingDef | undefined {
    return this.owned.find((e) => e.id === id);
  }

  private clear(): void {
    this.owned = [];
    this.dodgeCrit = this.haste = this.buffTime = 0;
    this.rage = false;
    this.parryTimes = [];
    this.recompute();
  }

  /** 가중치 무작위로 겹치지 않게 고른다. 희귀는 기본 낮은 확률 */
  private offer(title: string, elite: boolean): void {
    const pool = this.data.list.filter((e) => !this.has(e.id));
    if (!pool.length) return;
    const rareW = (this.prog.level('rare_pool') ? 0.7 : 0.35) * (elite ? 2.5 : 1);
    const picks: EngravingDef[] = [];
    const left = [...pool];
    while (picks.length < this.choices.rewardChoices && left.length) {
      const total = left.reduce((s, e) => s + (e.rarity === 'rare' ? rareW : 1), 0);
      let r = Math.random() * total;
      const i = left.findIndex((e) => (r -= e.rarity === 'rare' ? rareW : 1) <= 0);
      picks.push(left.splice(i < 0 ? 0 : i, 1)[0]);
    }
    this.offering = true;
    const options: RewardOption[] = picks.map((e) => ({ id: e.id, name: e.name, desc: e.desc, tags: e.tags, rarity: e.rarity }));
    bus.emit('rewardOffer', { title, options });
  }

  tagCounts(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const e of this.owned) for (const t of e.tags) c[t] = (c[t] ?? 0) + 1;
    return c;
  }

  activeTagBonuses(): string[] {
    const c = this.tagCounts();
    return Object.keys(this.data.tagBonuses).filter((t) => (c[t] ?? 0) >= this.choices.tagBonusCount);
  }

  tagBonusDesc(tag: string): string {
    return this.data.tagBonuses[tag]?.desc ?? '';
  }

  /** 영구 강화 + 각인 + 조건부 효과로 플레이어 수치를 다시 계산 */
  recompute(keepRatio = false): void {
    const p = this.prog.player;
    if (!p) return;
    const m = defaultMods();
    const perm = this.prog.permanent();
    const base = this.prog.base();
    m.parryWindowBonusMs += perm.parryWindowBonusMs;
    let maxHp = base.hp + perm.maxHp;
    let maxHpMul = 1;
    for (const e of this.owned) {
      if (e.staminaRegenMul) m.staminaRegenMul += e.staminaRegenMul;
      if (e.heavyDamageMul) m.heavyDamageMul += e.heavyDamageMul;
      if (e.postureMul) m.postureMul += e.postureMul;
      if (e.blockCostMul) m.blockCostMul += e.blockCostMul;
      if (e.damageTakenMul) m.damageTakenMul += e.damageTakenMul;
      if (e.damageMul && e.id !== 'rage') m.damageMul += e.damageMul;
      if (e.maxHp) maxHp += e.maxHp;
      if (e.maxHpMul) maxHpMul += e.maxHpMul;
      if (e.id === 'heavy_armor') m.heavyArmor = true;
    }
    for (const tag of this.activeTagBonuses()) {
      const b = this.data.tagBonuses[tag];
      for (const [k, v] of Object.entries(b)) {
        if (k === 'desc' || typeof v !== 'number') continue;
        (m as unknown as Record<string, number>)[k] += v;
      }
    }
    const rage = this.has('rage');
    if (rage && this.rage) m.damageMul += rage.damageMul ?? 0;
    const dc = this.has('dodge_crit');
    if (dc && this.dodgeCrit > 0) m.nextHitMul += dc.mul ?? 0;
    const hs = this.has('parry_haste');
    if (hs && this.haste > 0) m.attackSpeed += hs.attackSpeed ?? 0;
    if (this.buffTime > 0) {
      m.parryWindowBonusMs += this.buffParry;
      m.attackSpeed += this.buffSpeed;
    }

    Object.assign(p.mods, m);
    const v = p.vitals;
    const ratio = v.maxHp > 0 ? v.hp / v.maxHp : 1;
    v.maxHp = Math.round(maxHp * maxHpMul);
    v.hp = keepRatio ? Math.max(1, Math.round(v.maxHp * ratio)) : Math.min(v.hp, v.maxHp);
    v.maxStamina = base.stamina + perm.maxStamina;
  }

  private listenEffects(): void {
    const isMe = (f: unknown) => f === this.prog.player;
    bus.on('tick', ({ dt }) => {
      this.time += dt;
      let dirty = false;
      if (this.dodgeCrit > 0 && (this.dodgeCrit -= dt) <= 0) dirty = true;
      if (this.haste > 0 && (this.haste -= dt) <= 0) dirty = true;
      if (this.buffTime > 0 && (this.buffTime -= dt) <= 0) dirty = true;
      const rage = this.has('rage');
      const p = this.prog.player;
      if (rage && p) {
        const on = p.vitals.hp / p.vitals.maxHp <= (rage.threshold ?? 0.35);
        if (on !== this.rage) {
          this.rage = on;
          dirty = true;
        }
      }
      if (dirty) this.recompute();
    });
    bus.on('parrySuccess', (e) => {
      if (!isMe(e.defender)) return;
      const p = this.prog.player!;
      const heal = this.has('parry_heal');
      if (heal) bus.emit('heal', { target: p, amount: heal.heal ?? 0 });
      const wave = this.has('parry_wave');
      if (wave?.projectile) {
        const atk: AttackData = {
          id: 'parry_wave', startup: 0, active: 1, recovery: 0, cancelFrame: 0, damage: wave.damage ?? 15,
          posture: wave.posture ?? 20, advance: 0, hitstop: 3, hitSfx: 'slash', arc: { from: [0, 0], to: [0, 0] },
        };
        const dx = Math.sin(p.yaw), dz = Math.cos(p.yaw);
        bus.emit('fireProjectile', {
          owner: p, attack: atk, spec: wave.projectile,
          x: p.pos.x + dx, y: p.pos.y + wave.projectile.height, z: p.pos.z + dz, dx, dy: 0, dz,
        });
      }
      const hs = this.has('parry_haste');
      if (hs) {
        this.parryTimes = this.parryTimes.filter((t) => this.time - t < (hs.window ?? 10));
        this.parryTimes.push(this.time);
        if (this.parryTimes.length >= (hs.count ?? 3)) {
          this.parryTimes = [];
          this.haste = hs.seconds ?? 5;
          this.recompute();
          bus.emit('sfx', { key: 'heal' });
        }
      }
    });
    bus.on('skillBuff', (e) => {
      if (!isMe(e.fighter)) return;
      this.buffTime = e.seconds;
      this.buffParry = e.parryWindowBonusMs;
      this.buffSpeed = e.attackSpeed;
      this.recompute();
    });
    bus.on('dodgeStarted', (e) => {
      const dc = this.has('dodge_crit');
      if (!dc || !isMe(e.fighter)) return;
      this.dodgeCrit = dc.seconds ?? 1.5;
      this.recompute();
    });
    bus.on('dodged', (e) => {
      const gs = this.has('ghost_step');
      if (!gs || !isMe(e.defender)) return;
      const v = this.prog.player!.vitals;
      v.stamina = Math.min(v.maxStamina, v.stamina + (gs.stamina ?? 20));
    });
    bus.on('hit', (e) => {
      if (!isMe(e.attacker)) return;
      if (this.dodgeCrit > 0) {
        this.dodgeCrit = 0;
        this.recompute();
      }
      const fh = this.has('finisher_heal');
      if (fh && e.finisher) bus.emit('heal', { target: e.attacker, amount: e.attacker.vitals.maxHp * (fh.heal ?? 0.1) });
    });
  }
}

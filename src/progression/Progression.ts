import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { Fighter } from '../combat/Fighter';
import type { SwordDef } from '../player/Player';
import type { RoomDef } from '../world/Room';
import { Engravings } from './Engravings';
import { loadSave, writeSave, type SaveData } from './Save';

interface ProgressionData {
  saveKey: string;
  shardsKeepRatio: number;
  potions: number;
  restHeal: number;
  interactRadius: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  max: number;
  cost: number[];
  potions?: number;
  maxHp?: number;
  maxStamina?: number;
  parryWindowBonusMs?: number;
}

/** 영구 강화가 주는 수치 합계 */
export interface PermanentBonus {
  maxHp: number;
  maxStamina: number;
  parryWindowBonusMs: number;
  potions: number;
}

/**
 * 런 밖의 성장: 검의 파편, 회복약, 야영지 강화(기술 비석), 검 거치대, 저장.
 * 런 안의 성장(각인)은 Engravings가 맡는다.
 */
export class Progression {
  readonly d = getData<ProgressionData>('progression');
  readonly upgrades = getData<{ list: UpgradeDef[] }>('upgrades').list;
  readonly swords = getData<{ list: SwordDef[] }>('swords').list;
  readonly save: SaveData;
  readonly engravings: Engravings;
  player: Fighter | null = null;
  private runShards = 0;
  private potions = 0;
  private inCamp = false;
  private hint: string | null = null;
  private baseHp = 0;
  private baseStamina = 0;

  constructor() {
    this.save = loadSave(this.d.saveKey);
    this.engravings = new Engravings(this);
    bus.on('fighterSpawned', ({ fighter }) => {
      if (fighter.team !== 'player') return;
      this.player = fighter;
      this.baseHp = fighter.vitals.maxHp;
      this.baseStamina = fighter.vitals.maxStamina;
      this.engravings.recompute();
      // 플레이어가 만들어진 뒤에 장착 검과 설정을 알린다
      queueMicrotask(() => {
        bus.emit('equipSword', { id: this.save.equipped });
        bus.emit('settingsChanged', { settings: this.save.settings });
        this.emitShards();
      });
    });
    bus.on('death', ({ fighter }) => {
      if (fighter.team !== 'enemy' || fighter.kind === 'dummy') return;
      const [a, b] = getData<{ shards: [number, number] }>(`enemies/${fighter.kind}`).shards;
      this.runShards += a + Math.floor(Math.random() * (b - a + 1));
      this.emitShards();
      bus.emit('sfx', { key: 'pickup', volume: 0.6 });
    });
    bus.on('runStarted', () => {
      this.runShards = 0;
      this.setPotions(this.maxPotions());
      this.save.stats.runs++;
      this.persist();
    });
    bus.on('potionUsed', () => this.setPotions(this.potions - 1));
    bus.on('roomEntered', (e) => {
      this.inCamp = e.type === 'camp';
      if (this.inCamp) this.setPotions(this.maxPotions());
    });
    bus.on('roomCleared', (e) => {
      if (e.type !== 'rest') return;
      bus.emit('rewardOffer', {
        title: '모닥불 앞에서 숨을 고른다',
        options: [
          { id: 'rest_heal', name: '휴식', desc: `체력 ${Math.round(this.d.restHeal * 100)}% 회복` },
          { id: 'rest_potion', name: '회복약 끓이기', desc: '회복약 1개 충전' },
        ],
      });
    });
    bus.on('rewardChosen', ({ id }) => {
      if (id === 'rest_heal' && this.player) bus.emit('heal', { target: this.player, amount: this.player.vitals.maxHp * this.d.restHeal });
      if (id === 'rest_potion') this.setPotions(this.potions + 1);
    });
    bus.on('runEnded', ({ victory }) => this.bank(victory));
    bus.on('runSummary', ({ summary: s }) => this.record(s.victory, s.roomName, s.deathCause, s.seconds));
    bus.on('tick', () => this.updateHint());
    bus.on('interactPressed', () => this.interact());
    bus.on('buyUpgrade', ({ id }) => this.buy(id));
    bus.on('selectSword', ({ id }) => this.selectSword(id));
    bus.on('settingsChanged', ({ settings }) => {
      this.save.settings = settings;
      this.persist();
    });
  }

  level(id: string): number {
    return this.save.upgrades[id] ?? 0;
  }

  permanent(): PermanentBonus {
    const b: PermanentBonus = { maxHp: 0, maxStamina: 0, parryWindowBonusMs: 0, potions: 0 };
    for (const u of this.upgrades) {
      const lv = this.level(u.id);
      b.maxHp += (u.maxHp ?? 0) * lv;
      b.maxStamina += (u.maxStamina ?? 0) * lv;
      b.parryWindowBonusMs += (u.parryWindowBonusMs ?? 0) * lv;
      b.potions += (u.potions ?? 0) * lv;
    }
    return b;
  }

  base(): { hp: number; stamina: number } {
    return { hp: this.baseHp, stamina: this.baseStamina };
  }

  private maxPotions(): number {
    return this.d.potions + this.permanent().potions;
  }

  private setPotions(n: number): void {
    this.potions = Math.max(0, n);
    bus.emit('potionsChanged', { count: this.potions, max: this.maxPotions() });
  }

  private emitShards(): void {
    bus.emit('shardsChanged', { run: this.runShards, bank: this.save.shards });
  }

  /** 런 종료: 승리하면 전부, 사망하면 일정 비율만 남는다 */
  private bank(victory: boolean): void {
    const earned = this.runShards;
    const kept = victory ? earned : Math.floor(earned * this.d.shardsKeepRatio);
    this.save.shards += kept;
    this.runShards = 0;
    bus.emit('shardsBanked', { earned, kept });
    this.emitShards();
    this.persist();
  }

  /** 사망 기록·승리 기록(결과 화면 요약을 받은 뒤) */
  record(victory: boolean, room: string, cause: string, seconds: number): void {
    const st = this.save.stats;
    if (victory) {
      st.wins++;
      if (!st.bestSeconds || seconds < st.bestSeconds) st.bestSeconds = seconds;
    } else {
      st.deaths.push({ room, cause, seconds });
      if (st.deaths.length > 20) st.deaths.shift();
    }
    this.persist();
  }

  persist(): void {
    writeSave(this.d.saveKey, this.save);
    bus.emit('saveChanged', { save: this.save });
  }

  private campProps(): { kind: string; x: number; z: number; label?: string }[] {
    return getData<RoomDef>('rooms/camp').props ?? [];
  }

  private nearProp(): { kind: string; label?: string } | null {
    const p = this.player;
    if (!this.inCamp || !p) return null;
    for (const pr of this.campProps()) {
      if (pr.kind === 'bonfire') continue;
      if (Math.hypot(p.pos.x - pr.x, p.pos.z - pr.z) < this.d.interactRadius) return pr;
    }
    return null;
  }

  private updateHint(): void {
    const pr = this.nearProp();
    const text = pr ? `F — ${pr.label ?? ''}` : null;
    if (text !== this.hint) {
      this.hint = text;
      bus.emit('interactHint', { text });
    }
  }

  private interact(): void {
    const pr = this.nearProp();
    if (!pr) return;
    bus.emit('sfx', { key: 'ui' });
    bus.emit('openMenu', { kind: pr.kind === 'shrine' ? 'upgrades' : 'swords' });
  }

  private buy(id: string): void {
    const u = this.upgrades.find((x) => x.id === id);
    if (!u) return;
    const lv = this.level(id);
    if (lv >= u.max || this.save.shards < u.cost[lv]) return;
    this.save.shards -= u.cost[lv];
    this.save.upgrades[id] = lv + 1;
    this.engravings.recompute();
    this.setPotions(this.maxPotions());
    bus.emit('sfx', { key: 'pickup' });
    this.emitShards();
    this.persist();
  }

  private selectSword(id: string): void {
    const sw = this.swords.find((s) => s.id === id);
    if (!sw) return;
    if (!this.save.swords.includes(id)) {
      if (this.save.shards < sw.cost) return;
      this.save.shards -= sw.cost;
      this.save.swords.push(id);
      bus.emit('sfx', { key: 'pickup' });
    }
    this.save.equipped = id;
    bus.emit('equipSword', { id });
    this.emitShards();
    this.persist();
  }
}

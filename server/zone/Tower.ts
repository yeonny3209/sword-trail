import { MONSTERS } from '../../shared/data';
import { ITEMS, makeItem, rollRarity } from '../../shared/items';
import type { S2C } from '../../shared/protocol';
import { isBossFloor, TOWER, towerLevel, towerPlan, towerReward, towerScale, towerStart } from '../../shared/tower';
import type { MonsterDef, ZoneDef } from '../../shared/types';
import { newUid } from '../db';
import { addItem, syncInv } from './Inventory';
import type { Monster } from './Monster';
import type { PlayerSession } from './PlayerSession';

export interface TowerHost {
  zone: ZoneDef;
  players: Map<number, PlayerSession>;
  monsters: Map<number, Monster>;
  broadcast(m: S2C, except?: PlayerSession): void;
  spawn(def: MonsterDef, x: number, z: number): Monster;
  gainExp(p: PlayerSession, n: number): void;
}

type State = 'wait' | 'fight' | 'clear' | 'over';

/**
 * 시련의 탑: 층마다 몬스터 무리(5층마다 보스)가 나오고, 제한 시간 안에 모두 쓰러뜨리면 다음 층.
 * 층 레벨은 2층마다 +4(최고 40), 그 위로는 체력·공격력이 계속 오른다. 인원이 많으면 체력이 는다.
 * 깬 층마다 골드·경험치, 보스 층은 강화석·장비. 최고 층은 캐릭터에 기록되고, 5층 단위로 다음 도전을 이어서 시작한다.
 */
export class TowerSystem {
  floor = 0;
  private state: State = 'wait';
  /** 이 상태가 끝나는 시각 */
  private until = 0;
  private readonly mine = new Set<number>();
  private lastSend = 0;

  constructor(private readonly h: TowerHost) {}

  /** 첫 사람이 들어오면 그 사람 기록의 체크포인트부터 */
  onEnter(p: PlayerSession): void {
    if (this.floor === 0) {
      this.floor = towerStart(p.data.tower) - 1;
      this.state = 'clear';
      this.until = Date.now() + 4000;
      p.send({ t: 'banner', text: `시련의 탑 — ${this.floor + 1}층부터 시작합니다`, kind: 'good' });
    }
    this.sendState(p);
  }

  private alive(): number {
    let n = 0;
    for (const id of this.mine) if (this.h.monsters.get(id) && !this.h.monsters.get(id)!.dead) n++;
    return n;
  }

  private sendState(only?: PlayerSession): void {
    const left = Math.max(0, Math.ceil((this.until - Date.now()) / 1000));
    for (const p of only ? [only] : this.h.players.values()) {
      p.send({ t: 'tower', floor: Math.max(1, this.floor), left, alive: this.alive(), best: p.data.tower, state: this.state });
    }
  }

  private startFloor(now: number): void {
    this.floor++;
    this.state = 'fight';
    this.until = now + TOWER.floorSec * 1000;
    this.mine.clear();
    const plan = towerPlan(this.floor, Math.random);
    const sc = towerScale(this.floor, this.h.players.size);
    plan.forEach((id, i) => {
      const def = MONSTERS[id];
      if (!def) return;
      // 방 북쪽 반원에 둘러서 나온다(보스는 가운데)
      const boss = !!def.boss;
      const a = Math.PI * (0.15 + 0.7 * (plan.length > 1 ? i / (plan.length - 1) : 0.5));
      const x = boss ? 0 : Math.cos(a) * 12, z = boss ? -12 : -Math.sin(a) * 12 + 2;
      const m = this.h.spawn(def, x, z);
      m.temporary = true;
      m.mhp = Math.round(def.hp * sc.hp);
      m.hp = m.mhp;
      m.atkMul = sc.atk;
      m.cd = 1.5 + Math.random();
      m.leashless = true;
      // 탑 몬스터는 바로 덤빈다
      const alive = [...this.h.players.values()].filter((p) => !p.dead && !p.leaving);
      if (alive.length && !def.raid) m.target = alive[Math.floor(Math.random() * alive.length)];
      this.mine.add(m.id);
      this.h.broadcast({ t: 'mspawn', m: m.info() });
    });
    const lv = towerLevel(this.floor);
    this.h.broadcast({ t: 'banner', text: `${this.floor}층${isBossFloor(this.floor) ? ' — 수호자의 층!' : ''} (Lv${lv})`, kind: isBossFloor(this.floor) ? 'warn' : undefined });
    this.sendState();
  }

  private clearFloor(now: number): void {
    this.state = 'clear';
    this.until = now + TOWER.breakSec * 1000;
    const r = towerReward(this.floor);
    for (const p of this.h.players.values()) {
      if (p.leaving) continue;
      p.data.gold += r.gold;
      const got: { id: string; n: number; rar?: number }[] = [];
      if (r.stones) {
        const it = makeItem('enh_stone', r.stones, newUid());
        if (addItem(p, it) < it.n) got.push({ id: it.id, n: it.n });
      }
      if (isBossFloor(this.floor) && Math.random() < TOWER.equipChanceBoss) {
        const lv = towerLevel(this.floor);
        const pool = Object.values(ITEMS).filter((d) => d.kind === 'equip' && d.lv <= lv + 2 && d.lv >= lv - 8 && (!d.cls || d.cls === p.cls));
        const d = pool[Math.floor(Math.random() * pool.length)];
        if (d) {
          const rar = rollRarity(Math.random(), 1 + this.floor * 0.02);
          if (addItem(p, makeItem(d.id, 1, newUid(), rar)) === 0) got.push({ id: d.id, n: 1, rar });
        }
      }
      if (got.length) p.send({ t: 'loot', items: got });
      syncInv(p);
      if (this.floor > p.data.tower) {
        p.data.tower = this.floor;
        p.achieve('tower', undefined, this.floor);
      }
      p.dirty = true;
      p.send({ t: 'sys', text: `🗼 ${this.floor}층 돌파! 골드 ${r.gold.toLocaleString()}, 경험치 ${r.exp.toLocaleString()}${r.stones ? `, 강화석 ${r.stones}개` : ''}` });
      this.h.gainExp(p, r.exp);
    }
    this.h.broadcast({ t: 'banner', text: `${this.floor}층 돌파!`, kind: 'good' });
    this.sendState();
  }

  private fail(why: string): void {
    this.state = 'over';
    this.until = 0;
    for (const id of this.mine) {
      const m = this.h.monsters.get(id);
      if (m && !m.dead) {
        m.dead = true;
        m.respawnT = 0;
        this.h.broadcast({ t: 'mdie', id, by: 0 });
      }
    }
    this.mine.clear();
    this.h.broadcast({ t: 'banner', text: `${why} — ${this.floor}층에서 도전 종료`, kind: 'warn' });
    this.h.broadcast({ t: 'sys', text: '남쪽 포탈로 마을에 돌아갈 수 있습니다. 다시 들어오면 체크포인트(5층 단위)부터 이어서 도전합니다.' });
    this.sendState();
  }

  /** 20Hz */
  update(now: number): void {
    if (!this.h.players.size || this.state === 'over' || this.state === 'wait') return;
    if (this.state === 'clear' && now >= this.until) this.startFloor(now);
    else if (this.state === 'fight') {
      if (this.alive() === 0) this.clearFloor(now);
      else if (now >= this.until) this.fail('시간 초과');
      else if ([...this.h.players.values()].every((p) => p.dead)) this.fail('모두 쓰러졌습니다');
    }
    if (now - this.lastSend > 1000) {
      this.lastSend = now;
      this.sendState();
    }
  }
}

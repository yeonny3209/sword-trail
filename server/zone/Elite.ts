import { MONSTERS } from '../../shared/data';
import { resolveCircle } from '../../shared/geom';
import type { S2C } from '../../shared/protocol';
import type { MonsterDef, ZoneDef } from '../../shared/types';
import type { Monster } from './Monster';
import type { PlayerSession } from './PlayerSession';

export interface EliteHost {
  zone: ZoneDef;
  players: Map<number, PlayerSession>;
  broadcast(m: S2C): void;
  spawn(def: MonsterDef, x: number, z: number): Monster;
}

/**
 * 파티 사냥 이벤트: 사냥터에 사람이 있으면 몇 분마다 정예 몬스터가 한 마리 나타난다.
 * 체력이 8배라 혼자서는 힘들고, 파티가 힘을 합쳐 잡으면 파티원 각자 장비와 강화석을 받는다.
 */
export class EliteSystem {
  private current: Monster | null = null;
  private nextAt = Date.now() + this.delay(120_000, 90_000);

  constructor(private readonly h: EliteHost) {}

  private delay(base: number, spread: number): number {
    return base + Math.random() * spread;
  }

  update(now: number): void {
    if (this.h.zone.type !== 'field') return;
    if (this.current?.dead) {
      this.current = null;
      this.nextAt = now + this.delay(180_000, 120_000);
    }
    if (this.current || now < this.nextAt) return;
    const alive = [...this.h.players.values()].filter((p) => !p.dead && !p.leaving);
    if (!alive.length) {
      this.nextAt = now + 20_000;
      return;
    }
    const choices = this.h.zone.spawns.map((s) => MONSTERS[`${s.monster}_elite`]).filter((d): d is MonsterDef => !!d);
    const def = choices[Math.floor(Math.random() * choices.length)];
    if (!def) {
      this.nextAt = now + 60_000;
      return;
    }
    const p = alive[Math.floor(Math.random() * alive.length)];
    const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 4;
    const [x, z] = resolveCircle(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, def.radius, this.h.zone.walls, this.h.zone.size);
    const m = this.h.spawn(def, x, z);
    m.temporary = true;
    this.current = m;
    this.h.broadcast({ t: 'banner', text: `${def.name}이(가) 나타났다! 파티와 함께 잡아 보세요`, kind: 'warn' });
  }
}

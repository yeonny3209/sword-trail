import type * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { Physics } from '../core/Physics';
import type { Fighter } from '../combat/Fighter';
import { Enemy, type Brain } from './Enemy';
import { MeleeBrain } from './MeleeBrain';
import { TokenManager } from './TokenManager';
import type { EnemyData } from './types';

/** 적 생성·갱신·제거. 'spawnEnemy' 이벤트로 적을 만든다. */
export class EnemyManager {
  readonly enemies: Enemy[] = [];
  readonly tokens = new TokenManager();
  private player: Fighter | null = null;
  private readonly brains = new Map<string, () => Brain>();

  constructor(private readonly scene: THREE.Scene, private readonly physics: Physics) {
    this.registerBrain('melee', () => new MeleeBrain());
    bus.on('fighterSpawned', ({ fighter }) => {
      if (fighter.team === 'player') this.player = fighter;
    });
    bus.on('spawnEnemy', (e) => this.spawn(e.type, e.x, e.z, e.yaw ?? Math.PI));
    bus.on('clearEnemies', () => this.clear());
  }

  registerBrain(name: string, make: () => Brain): void {
    this.brains.set(name, make);
  }

  spawn(type: string, x: number, z: number, yaw: number): Enemy {
    const data = getData<EnemyData & { brain?: string }>(`enemies/${type}`);
    const make = this.brains.get(data.brain ?? 'melee') ?? this.brains.get('melee')!;
    const e = new Enemy(this.scene, this.physics, type, data, x, z, yaw, this.tokens, make());
    this.enemies.push(e);
    return e;
  }

  update(dt: number): void {
    for (const e of this.enemies) e.update(dt, this.player);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].removed) {
        this.enemies[i].dispose();
        this.enemies.splice(i, 1);
      }
    }
  }

  render(alpha: number, realDt: number): void {
    for (const e of this.enemies) e.render(alpha, realDt);
  }

  clear(): void {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    this.tokens.clear();
  }

  aliveCount(): number {
    return this.enemies.filter((e) => e.fighter.alive).length;
  }
}

import type * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { Physics } from '../core/Physics';
import type { Fighter } from '../combat/Fighter';
import { Room, type RoomBuildData, type RoomDef } from './Room';

interface ZoneDef {
  name: string;
  sequence: string[];
  pools: Record<string, string[]>;
  boss: string;
}

interface RunData extends RoomBuildData {
  zones: ZoneDef[];
  camp: string;
  firstWaveDelay: number;
  waveDelay: number;
  exitRadius: number;
  deathScreenDelay: number;
  transitionSeconds: number;
}

type Phase = 'camp' | 'fighting' | 'cleared' | 'dead' | 'victory' | 'ended';

/**
 * 런 진행: 야영지 → 구역의 방들(전투·휴식·정예) → 보스방 → 승리/사망 → 야영지.
 * 방에 들어서면 출구가 닫히고, 웨이브를 모두 처치하면 열린다.
 */
export class RunManager {
  private readonly d = getData<RunData>('run');
  private room: Room | null = null;
  private phase: Phase = 'camp';
  private sequence: { def: RoomDef; zone: string }[] = [];
  private index = -1;
  private wave = 0;
  private waveTimer = 0;
  private readonly alive = new Set<number>();
  private player: Fighter | null = null;
  private timer = 0;
  private pending: (() => void) | null = null;
  private pendingTimer = 0;

  constructor(private readonly scene: THREE.Scene, private readonly physics: Physics) {
    bus.on('fighterSpawned', ({ fighter }) => {
      if (fighter.team === 'player') this.player = fighter;
      else if (fighter.kind !== 'dummy') this.alive.add(fighter.id);
    });
    bus.on('fighterRemoved', ({ fighter }) => this.alive.delete(fighter.id));
    bus.on('death', ({ fighter }) => {
      this.alive.delete(fighter.id);
      if (fighter === this.player && this.phase !== 'ended') {
        this.phase = 'dead';
        this.timer = this.d.deathScreenDelay;
      }
    });
    bus.on('returnToCamp', () => this.later(() => this.goCamp()));
  }

  get roomDef(): RoomDef | null {
    return this.room?.def ?? null;
  }

  start(): void {
    this.goCamp();
  }

  /** 페이드 아웃 뒤에 실행 */
  private later(fn: () => void): void {
    bus.emit('transition', { seconds: this.d.transitionSeconds });
    this.pending = fn;
    this.pendingTimer = this.d.transitionSeconds / 2;
  }

  private load(def: RoomDef, zone: string, index: number, total: number): void {
    bus.emit('clearEnemies', {});
    this.alive.clear();
    this.room?.dispose();
    this.room = new Room(this.scene, this.physics, def, this.d);
    const [x, z, yaw] = def.playerStart;
    bus.emit('teleportPlayer', { x, z, yaw });
    for (const [dx, dz, dyaw] of def.dummies ?? []) bus.emit('spawnEnemy', { type: 'dummy', x: dx, z: dz, yaw: dyaw });
    bus.emit('roomEntered', { name: def.name, zone, index, total, type: def.type });
  }

  private goCamp(): void {
    this.index = -1;
    this.load(getData<RoomDef>(`rooms/${this.d.camp}`), '야영지', 0, 0);
    bus.emit('resetPlayer', {});
    this.room!.openGate();
    this.phase = 'camp';
  }

  private startRun(): void {
    // 구역마다 정해진 순서대로, 각 종류의 방 풀에서 겹치지 않게 무작위로 고른다
    this.sequence = [];
    for (const zone of this.d.zones) {
      const used = new Set<string>();
      for (const kind of zone.sequence) {
        const pool = zone.pools[kind].filter((id) => !used.has(id));
        const id = (pool.length ? pool : zone.pools[kind])[Math.floor(Math.random() * (pool.length || zone.pools[kind].length))];
        used.add(id);
        this.sequence.push({ def: getData<RoomDef>(`rooms/${id}`), zone: zone.name });
      }
      this.sequence.push({ def: getData<RoomDef>(`rooms/${zone.boss}`), zone: zone.name });
    }
    bus.emit('runStarted', { seed: Date.now() });
    this.enter(0);
  }

  private enter(i: number): void {
    this.index = i;
    const { def, zone } = this.sequence[i];
    this.load(def, zone, i + 1, this.sequence.length);
    this.wave = 0;
    if (def.waves.length) {
      this.phase = 'fighting';
      this.waveTimer = this.d.firstWaveDelay;
    } else {
      this.clear();
    }
  }

  private clear(): void {
    this.phase = 'cleared';
    const def = this.room!.def;
    this.room!.openGate();
    bus.emit('gateOpened', {});
    bus.emit('sfx', { key: 'gate' });
    bus.emit('roomCleared', { type: def.type, roomId: def.id });
    if (def.type === 'boss') {
      this.phase = 'victory';
      this.timer = 2.5;
    }
  }

  update(dt: number): void {
    if (this.pending) {
      this.pendingTimer -= dt;
      if (this.pendingTimer <= 0) {
        const fn = this.pending;
        this.pending = null;
        fn();
      }
      return;
    }
    const p = this.player;
    switch (this.phase) {
      case 'fighting': {
        if (this.alive.size > 0) return;
        this.waveTimer -= dt;
        if (this.waveTimer > 0) return;
        const waves = this.room!.def.waves;
        if (this.wave >= waves.length) return this.clear();
        for (const s of waves[this.wave]) bus.emit('spawnEnemy', { type: s.type, x: s.x, z: s.z, yaw: Math.PI });
        this.wave++;
        bus.emit('waveStarted', { index: this.wave, total: waves.length });
        this.waveTimer = this.d.waveDelay;
        return;
      }
      case 'camp':
        if (p && this.room!.atExit(p.pos.x, p.pos.z, this.d.exitRadius)) {
          this.phase = 'ended';
          this.later(() => this.startRun());
        }
        return;
      case 'cleared':
        if (p && p.alive && this.room!.atExit(p.pos.x, p.pos.z, this.d.exitRadius)) {
          this.phase = 'ended';
          this.later(() => this.enter(this.index + 1));
        }
        return;
      case 'dead':
      case 'victory':
        this.timer -= dt;
        if (this.timer <= 0) {
          bus.emit('runEnded', { victory: this.phase === 'victory' });
          this.phase = 'ended';
        }
        return;
    }
  }

  render(realDt: number): void {
    this.room?.update(realDt);
  }
}

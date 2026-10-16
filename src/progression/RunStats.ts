import { bus } from '../core/bus';

export interface RunSummary {
  victory: boolean;
  seconds: number;
  kills: number;
  parries: number;
  parryAttempts: number;
  blocks: number;
  dodges: number;
  damageTaken: number;
  roomsCleared: number;
  roomName: string;
  deathCause: string;
  shardsEarned: number;
  shardsKept: number;
  engravings: string[];
}

/**
 * 런 자동 기록: 런 시간, 사망 위치·원인, 패링 시도·성공 횟수 등.
 * 결과 화면과 저장(통계)에 쓴다.
 */
export class RunStats {
  private s: RunSummary = RunStats.empty();
  private frames = 0;
  private running = false;
  private lastHitBy = '';

  static empty(): RunSummary {
    return {
      victory: false, seconds: 0, kills: 0, parries: 0, parryAttempts: 0, blocks: 0, dodges: 0,
      damageTaken: 0, roomsCleared: 0, roomName: '', deathCause: '', shardsEarned: 0, shardsKept: 0, engravings: [],
    };
  }

  constructor() {
    bus.on('runStarted', () => {
      this.s = RunStats.empty();
      this.frames = 0;
      this.running = true;
    });
    bus.on('tick', () => this.running && this.frames++);
    bus.on('roomEntered', (e) => (this.s.roomName = e.name));
    bus.on('roomCleared', (e) => e.type !== 'rest' && this.s.roomsCleared++);
    bus.on('death', (e) => {
      if (e.fighter.team === 'enemy' && e.fighter.kind !== 'dummy') this.s.kills++;
      if (e.fighter.team === 'player') this.s.deathCause = this.lastHitBy;
    });
    bus.on('blockStarted', (e) => e.fighter.team === 'player' && this.s.parryAttempts++);
    bus.on('parrySuccess', (e) => e.defender.team === 'player' && this.s.parries++);
    bus.on('blocked', (e) => e.defender.team === 'player' && this.s.blocks++);
    bus.on('dodged', (e) => e.defender.team === 'player' && this.s.dodges++);
    bus.on('hit', (e) => {
      if (e.target.team !== 'player') return;
      this.s.damageTaken += e.damage;
      this.lastHitBy = `${e.attacker.name}의 ${e.attack.id}`;
    });
    bus.on('runEnded', ({ victory }) => {
      this.running = false;
      this.s.victory = victory;
      this.s.seconds = Math.round(this.frames / 60);
      bus.emit('runSummary', { summary: this.s });
    });
  }

  get current(): RunSummary {
    return this.s;
  }
}

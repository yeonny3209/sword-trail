import { disabled, newBody, stepBody, type Body } from '../../shared/combat';
import { dist2, resolveCircle, wrapAngle, yawTo } from '../../shared/geom';
import { MonState, type MonsterInfo, type S2C } from '../../shared/protocol';
import type { MonsterDef, Rect, ZoneDef } from '../../shared/types';
import type { PlayerSession } from './PlayerSession';

let nextId = 1;

/** 몬스터 공격 기록(피격 보고 검증용) */
export interface AttackWindow {
  k: number;
  start: number;
  activeStart: number;
  activeEnd: number;
  /** 이 공격에 이미 맞았다고 보고한 플레이어 */
  hurt: Set<number>;
}

/**
 * 서버의 몬스터 한 마리: 배회 → 추격 → 예비 동작 → 공격 → 회복.
 * 맞으면 공용 반응 물리(Body)로 밀리고 띄워지며, 그동안은 행동하지 못한다.
 */
export class Monster {
  readonly id = nextId++;
  readonly body: Body;
  f = Math.random() * Math.PI * 2;
  state = MonState.Idle;
  stateT = 0;
  hp: number;
  /** 이 개체의 최대 체력(레이드는 인원에 따라 늘어남) */
  mhp: number;
  /** 레이드 단계·격노로 바뀌는 배율 */
  atkMul = 1;
  speedMul = 1;
  cdMul = 1;
  /** 보스가 소환한 부하: 보상 없이 쓰러지면 사라짐 */
  summoned = false;
  /** 최근 입힌 피해(시간이 지나면 줄어듦) — 레이드 보스가 누굴 노릴지 */
  readonly threat = new Map<number, number>();
  /** 지금까지 입힌 피해 합계 — 레이드 보상을 받을 자격 */
  readonly dealt = new Map<number, number>();
  private retargetT = 0;
  /** 레이드 보스: 공격마다 따로 센 쿨타임(초) */
  private readonly acd: number[];
  target: PlayerSession | null = null;
  attack = -1;
  cd = 1 + Math.random();
  dead = false;
  respawnT = 0;
  wanderT = 0;
  wanderX: number;
  wanderZ: number;
  window: AttackWindow | null = null;
  /** 마지막으로 때린 플레이어(어그로) */
  lastAttacker = 0;

  constructor(readonly def: MonsterDef, private readonly area: Rect, zone: ZoneDef) {
    const [x, z] = this.randomPoint(zone);
    this.body = newBody(x, z);
    this.hp = def.hp;
    this.mhp = def.hp;
    this.acd = def.attacks.map(() => 0);
    this.wanderX = x;
    this.wanderZ = z;
  }

  private randomPoint(zone: ZoneDef): [number, number] {
    const a = this.area;
    const x = a.x + (Math.random() - 0.5) * a.w;
    const z = a.z + (Math.random() - 0.5) * a.d;
    return resolveCircle(x, z, this.def.radius, zone.walls, zone.size);
  }

  info(): MonsterInfo {
    return { id: this.id, kind: this.def.id, lv: this.def.lv, x: this.body.x, z: this.body.z, f: this.f, hp: this.hp, mhp: this.mhp };
  }

  snap(): number[] {
    const r = (v: number) => Math.round(v * 100) / 100;
    const b = this.body;
    return [this.id, r(b.x), r(b.z), r(b.y), r(this.f), this.state, Math.max(0, Math.round(this.hp))];
  }

  private set(s: MonState): void {
    this.state = s;
    this.stateT = 0;
  }

  addDamage(id: number, n: number): void {
    this.threat.set(id, (this.threat.get(id) ?? 0) + n);
    this.dealt.set(id, (this.dealt.get(id) ?? 0) + n);
  }

  /** 레이드 보스: 최근 가장 많이 때린 사람을 노린다(4~6초마다 다시 고름) */
  private pickRaidTarget(dt: number, players: Iterable<PlayerSession>): void {
    const decay = Math.exp(-0.12 * dt);
    for (const [k, v] of this.threat) this.threat.set(k, v * decay);
    this.retargetT -= dt;
    if (this.target && this.retargetT > 0) return;
    let best: PlayerSession | null = null, score = -1;
    for (const p of players) {
      if (p.dead || p.leaving) continue;
      const sc = (this.threat.get(p.id) ?? 0) + 1 + Math.random();
      if (sc > score) {
        score = sc;
        best = p;
      }
    }
    this.target = best;
    this.retargetT = 4 + Math.random() * 2;
  }

  /** 레이드 보스의 공격 고르기: 쿨타임이 찬 공격 중 무작위, 강한 공격을 더 자주 */
  private pickRaidAttack(dist: number): number {
    if (this.cd > 0) return -1;
    const ok: number[] = [];
    this.def.attacks.forEach((a, i) => {
      if (dist <= a.range && this.acd[i] <= 0) ok.push(i);
    });
    if (!ok.length) return -1;
    const heavy = ok.filter((i) => this.def.attacks[i].heavy);
    const from = heavy.length && Math.random() < 0.6 ? heavy : ok;
    return from[Math.floor(Math.random() * from.length)];
  }

  /** 맞아서 하던 공격이 끊긴다(강인함이면 유지) */
  interrupt(): void {
    if (this.def.superArmor) return;
    if (this.state === MonState.Windup || this.state === MonState.Attack) {
      this.window = null;
      this.cd = Math.max(this.cd, 0.6);
    }
    this.set(MonState.Hit);
  }

  respawn(zone: ZoneDef): void {
    const [x, z] = this.randomPoint(zone);
    Object.assign(this.body, newBody(x, z));
    this.hp = this.mhp;
    this.dead = false;
    this.target = null;
    this.window = null;
    this.set(MonState.Idle);
  }

  update(dt: number, zone: ZoneDef, players: Iterable<PlayerSession>, emit: (m: S2C) => void): void {
    if (this.dead) return;
    const b = this.body, d = this.def;
    stepBody(b, dt, zone.walls, zone.size, d.radius);
    this.stateT += dt;
    if (disabled(b)) {
      this.state = b.air ? MonState.Air : b.down > 0 ? MonState.Down : MonState.Hit;
      this.window = null;
      return;
    }
    if (this.state === MonState.Hit || this.state === MonState.Air || this.state === MonState.Down) this.set(MonState.Idle);
    this.cd -= dt;
    if (d.raid) for (let i = 0; i < this.acd.length; i++) this.acd[i] -= dt;

    // 대상 고르기: 가까운 살아 있는 플레이어. 집에서 너무 멀어지면 포기
    const homeD = dist2(b.x, b.z, this.area.x, this.area.z);
    const leashed = homeD > (d.leash + Math.max(this.area.w, this.area.d) / 2) ** 2;
    if (this.target && (this.target.dead || this.target.leaving || leashed)) this.target = null;
    if (d.raid) this.pickRaidTarget(dt, players);
    else if (!this.target && !leashed) {
      let best = d.aggro * d.aggro;
      for (const p of players) {
        if (p.dead || p.leaving) continue;
        const dd = dist2(b.x, b.z, p.x, p.z);
        if (dd < best || p.id === this.lastAttacker) {
          best = dd;
          this.target = p;
          if (p.id === this.lastAttacker) break;
        }
      }
    }
    const t = this.target;

    switch (this.state) {
      case MonState.Idle:
      case MonState.Move: {
        if (t) {
          const dist = Math.sqrt(dist2(b.x, b.z, t.x, t.z));
          const want = yawTo(b.x, b.z, t.x, t.z);
          this.turn(want, 8, dt);
          const k = d.raid ? this.pickRaidAttack(dist) : d.attacks.findIndex((a) => dist <= a.range && this.cd <= 0);
          if (k >= 0 && Math.abs(wrapAngle(want - this.f)) < 0.6) return this.startAttack(k, emit);
          if (dist > Math.min(...d.attacks.map((a) => a.range)) * 0.8) this.walk(want, d.speed * this.speedMul, dt, zone);
          else this.state = MonState.Idle;
          return;
        }
        // 배회
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 2 + Math.random() * 4;
          [this.wanderX, this.wanderZ] = leashed ? [this.area.x, this.area.z] : this.randomPoint(zone);
        }
        if (dist2(b.x, b.z, this.wanderX, this.wanderZ) > 0.6) {
          const want = yawTo(b.x, b.z, this.wanderX, this.wanderZ);
          this.turn(want, 5, dt);
          this.walk(want, d.speed * this.speedMul * (leashed ? 1.2 : 0.45), dt, zone);
        } else this.state = MonState.Idle;
        return;
      }
      case MonState.Windup: {
        const a = d.attacks[this.attack];
        if (t) this.turn(yawTo(b.x, b.z, t.x, t.z), 3, dt);
        if (this.stateT >= a.windup) this.set(MonState.Attack);
        return;
      }
      case MonState.Attack: {
        const a = d.attacks[this.attack];
        if (a.lunge) this.walk(this.f, a.lunge, dt, zone);
        if (this.stateT >= a.active) this.set(MonState.Recover);
        return;
      }
      case MonState.Recover: {
        const a = d.attacks[this.attack];
        if (this.stateT >= a.recover) {
          this.cd = d.raid ? (0.4 + Math.random() * 0.7) * this.cdMul : a.cd * (0.8 + Math.random() * 0.4) * this.cdMul;
          this.set(MonState.Idle);
        }
        return;
      }
    }
  }

  private startAttack(k: number, emit: (m: S2C) => void): void {
    const a = this.def.attacks[k];
    const now = Date.now();
    this.attack = k;
    if (this.def.raid) this.acd[k] = a.cd * this.cdMul;
    this.set(MonState.Windup);
    this.window = {
      k, start: now,
      activeStart: now + a.windup * 1000,
      activeEnd: now + (a.windup + a.active) * 1000,
      hurt: new Set(),
    };
    emit({ t: 'matk', id: this.id, k, f: this.f });
  }

  private turn(want: number, speed: number, dt: number): void {
    const d = wrapAngle(want - this.f);
    this.f += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
  }

  private walk(yaw: number, speed: number, dt: number, zone: ZoneDef): void {
    const b = this.body;
    [b.x, b.z] = resolveCircle(b.x + Math.sin(yaw) * speed * dt, b.z + Math.cos(yaw) * speed * dt, this.def.radius, zone.walls, zone.size);
    if (this.state === MonState.Idle) this.state = MonState.Move;
  }
}

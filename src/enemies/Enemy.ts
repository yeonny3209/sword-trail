import * as THREE from 'three';
import { bus } from '../core/bus';
import { turnTowards, yawTo, randRange } from '../core/math';
import type { CharacterBody, Physics } from '../core/Physics';
import { AttackRunner } from '../combat/AttackRunner';
import { Fighter } from '../combat/Fighter';
import { FighterView } from '../combat/FighterView';
import type { TokenManager } from './TokenManager';
import type { EnemyAttack, EnemyData } from './types';

export type EnemyState =
  | 'idle' | 'approach' | 'circle' | 'engage' | 'attack' | 'recover'
  | 'retreat' | 'hitstun' | 'parried' | 'broken' | 'phaseShift' | 'dead';

/** 적 행동 결정(상태 기계). 일반 적은 MeleeBrain, 보스는 BossBrain */
export interface Brain {
  update(e: Enemy, target: Fighter, dt: number): void;
  /** 공격이 끝났을 때 다음 행동 결정 */
  onAttackDone?(e: Enemy): void;
}

/** 적 본체: 몸·검·물리와 전투 반응. 무엇을 할지는 Brain이 정한다. */
export class Enemy {
  readonly fighter: Fighter;
  readonly view: FighterView;
  readonly body: CharacterBody;
  state: EnemyState = 'idle';
  stunFrames = 0;
  /** 다음 공격 시도까지 남은 초 */
  cooldown: number;
  circleDir = Math.random() < 0.5 ? 1 : -1;
  circleTimer = 0;
  engageTime = 0;
  choice: EnemyAttack | null = null;
  readonly push = new THREE.Vector2();
  /** 사망 후 경과 초 */
  deadTime = 0;
  removed = false;
  /** 피격 흔들림 남은 시간 */
  private shakeTime = 0;
  private offs: (() => void)[] = [];
  /** 보스 페이즈 등 brain이 쓰는 값 */
  phase = 1;

  constructor(
    private readonly scene: THREE.Scene,
    physics: Physics,
    readonly type: string,
    readonly data: EnemyData,
    x: number,
    z: number,
    yaw: number,
    readonly tokens: TokenManager,
    readonly brain: Brain,
  ) {
    const d = data;
    this.fighter = new Fighter({
      team: 'enemy', name: d.name, kind: type, radius: d.radius, height: d.height, sword: d.sword,
      hp: d.hp, posture: d.posture, postureRegenDelay: d.postureRegenDelay, postureRegen: d.postureRegen,
    });
    this.fighter.pos.set(x, 0, z);
    this.fighter.yaw = yaw;
    this.fighter.superArmor = !!d.superArmor;
    this.fighter.snap();
    this.view = new FighterView(this.fighter, scene, {
      shape: d.shape ?? 'capsule', color: d.color, swordColor: d.swordColor, swordWidth: d.swordWidth,
    });
    this.body = physics.createCharacter(d.radius, d.height, x, z);
    this.cooldown = randRange(d.attackCooldown[0], d.attackCooldown[1]);
    this.listen();
    bus.emit('fighterSpawned', { fighter: this.fighter });
  }

  private listen(): void {
    const me = this.fighter;
    this.offs.push(
      bus.on('hit', (e) => {
        if (e.target !== me || !me.alive) return;
        this.view.tint(this.data.hitColor, 0.12);
        this.shakeTime = 0.2;
        this.knockFrom(e.attacker.pos, (e.attack.knockback ?? 1) * this.data.knockback);
        if (me.isBroken() || this.state === 'broken') return;
        const armored = me.superArmor || !!me.attack?.data.superArmor;
        if (armored) return;
        this.interrupt();
        this.stunFrames = this.data.hitstunFrames;
        this.setState('hitstun');
      }),
      bus.on('parrySuccess', (e) => {
        if (e.attacker !== me || !me.alive || me.isBroken()) return;
        if (Math.hypot(e.defender.pos.x - me.pos.x, e.defender.pos.z - me.pos.z) > 4) return;
        // 강인한 적(보스)의 연속기는 마지막 타를 패링해야 끊긴다
        if (me.superArmor && (e.attack as EnemyAttack).next) return;
        this.interrupt();
        this.knockFrom(e.defender.pos, 0.6);
        this.stunFrames = this.data.parriedFrames;
        this.setState('parried');
      }),
      bus.on('postureBreak', (e) => {
        if (e.fighter !== me) return;
        this.interrupt();
        this.setState('broken');
      }),
      bus.on('death', (e) => {
        if (e.fighter !== me) return;
        this.interrupt();
        this.setState('dead');
      }),
    );
  }

  setState(s: EnemyState): void {
    this.state = s;
    this.fighter.setState(s);
  }

  /** 하던 행동을 끊고 토큰을 반납한다 */
  interrupt(): void {
    this.fighter.attack = null;
    this.fighter.pose = [...this.data.sword.rest];
    this.choice = null;
    this.releaseToken();
  }

  requestToken(): boolean {
    if (this.data.ignoreTokens) return true;
    const ok = this.tokens.request(this.fighter.id);
    this.fighter.hasToken = ok;
    return ok;
  }

  releaseToken(): void {
    this.tokens.release(this.fighter.id);
    this.fighter.hasToken = false;
  }

  resetCooldown(mul = 1): void {
    const [a, b] = this.data.attackCooldown;
    this.cooldown = randRange(a, b) * mul;
  }

  private knockFrom(from: THREE.Vector3, strength: number): void {
    const dx = this.fighter.pos.x - from.x, dz = this.fighter.pos.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    this.push.set((dx / len) * strength * 10, (dz / len) * strength * 10);
  }

  distTo(t: Fighter): number {
    return Math.hypot(t.pos.x - this.fighter.pos.x, t.pos.z - this.fighter.pos.z);
  }

  yawTo(t: Fighter): number {
    return yawTo(this.fighter.pos.x, this.fighter.pos.z, t.pos.x, t.pos.z);
  }

  face(yaw: number, speed: number, dt: number): void {
    this.fighter.yaw = turnTowards(this.fighter.yaw, yaw, speed * dt);
  }

  /** 월드 방향(dx, dz)으로 speed m/s 이동 */
  moveDir(dx: number, dz: number, speed: number, dt: number): void {
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return this.move(0, 0, dt);
    this.move((dx / len) * speed * dt, (dz / len) * speed * dt, dt);
  }

  move(dx: number, dz: number, dt: number): void {
    this.body.move(dx, dz, dt);
    this.fighter.pos.set(this.body.x, this.body.y, this.body.z);
  }

  startAttack(atk: EnemyAttack): void {
    const f = this.fighter;
    this.choice = atk;
    f.attack = new AttackRunner(f, atk, f.mods.attackSpeed);
    this.setState('attack');
    bus.emit('attackStarted', { fighter: f, attack: atk });
    if (atk.glow) bus.emit('telegraph', { fighter: f, attack: atk, frames: atk.startup });
  }

  findAttack(id: string): EnemyAttack | undefined {
    return this.data.attacks.find((a) => a.id === id);
  }

  update(dt: number, target: Fighter | null): void {
    const f = this.fighter;
    f.beginTick();
    f.stateFrame++;
    if (this.state === 'dead') {
      this.deadTime += dt;
      this.view.sink = Math.max(0, this.deadTime - 0.5) * 1.2;
      if (this.deadTime >= this.data.deathSinkSeconds) this.removed = true;
    } else if (target) {
      this.brain.update(this, target, dt);
    }
    if (this.push.lengthSq() > 0.01) {
      this.move(this.push.x * dt, this.push.y * dt, dt);
      this.push.multiplyScalar(Math.exp(-12 * dt));
    } else if (this.state === 'dead' || this.state === 'broken' || this.state === 'idle') {
      this.move(0, 0, dt);
    }
    f.updateSword();
  }

  render(alpha: number, realDt: number): void {
    const run = this.fighter.attack;
    const startup = run && run.phase() === 'startup';
    // 예비 동작 동안 검에 빛: 점점 밝아진다
    this.view.setGlow(startup ? run.data.glow ?? null : null, startup ? 0.4 + 0.8 * (run.frame / run.data.startup) : 1);
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - realDt);
      this.view.shakeX = Math.sin(this.shakeTime * 90) * 0.08 * (this.shakeTime / 0.2);
    } else {
      this.view.shakeX = 0;
    }
    const lean = this.state === 'broken' ? -0.4 : this.state === 'parried' ? -0.2 : this.state === 'dead' ? -1.2 : 0;
    this.view.body.rotation.x += (lean - this.view.body.rotation.x) * Math.min(1, realDt * 12);
    if (this.state === 'broken') this.view.tint('#ff60ff', 0.05);
    this.view.render(alpha, realDt);
  }

  dispose(): void {
    this.releaseToken();
    this.offs.forEach((o) => o());
    this.view.dispose(this.scene);
    this.body.dispose();
    bus.emit('fighterRemoved', { fighter: this.fighter });
  }
}

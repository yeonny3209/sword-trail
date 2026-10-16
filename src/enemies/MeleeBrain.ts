import { bus } from '../core/bus';
import { randRange } from '../core/math';
import type { Fighter } from '../combat/Fighter';
import type { Brain, Enemy } from './Enemy';
import type { EnemyAttack } from './types';

/**
 * 일반 적 상태 기계:
 * 대기 → 접근 → 간격 유지(주변을 돎) → [토큰 획득] 거리 좁히기 → 공격 → 회복
 * 피격 / 패링당함 / 자세 붕괴 / 사망은 Enemy가 이벤트로 전환한다.
 */
export class MeleeBrain implements Brain {
  update(e: Enemy, t: Fighter, dt: number): void {
    const d = e.data;
    const dist = e.distTo(t);
    const toYaw = e.yawTo(t);
    if (!t.alive && e.state !== 'attack') {
      e.releaseToken();
      e.setState('idle');
    }

    switch (e.state) {
      case 'idle':
        e.move(0, 0, dt);
        if (t.alive && dist < d.aggroRange) e.setState('approach');
        return;

      case 'approach':
        e.face(toYaw, d.turnSpeed, dt);
        if (dist <= d.keepDistance[1]) return e.setState('circle');
        e.moveDir(t.pos.x - e.fighter.pos.x, t.pos.z - e.fighter.pos.z, d.moveSpeed, dt);
        return;

      case 'circle':
        return this.circle(e, t, dist, toYaw, dt);

      case 'retreat': {
        e.face(toYaw, d.turnSpeed, dt);
        const away = toYaw + Math.PI;
        e.moveDir(Math.sin(away), Math.cos(away), d.moveSpeed * 0.9, dt);
        if (dist >= (d.keepDistance[0] + d.keepDistance[1]) / 2 || e.fighter.stateFrame > 90) e.setState('circle');
        return;
      }

      case 'engage': {
        e.engageTime += dt;
        const atk = e.choice;
        if (!atk || e.engageTime > d.engageTimeout) {
          e.releaseToken();
          e.resetCooldown(0.5);
          return e.setState('circle');
        }
        e.face(toYaw, d.turnSpeed, dt);
        if (dist <= atk.range) return this.attack(e, atk);
        e.moveDir(t.pos.x - e.fighter.pos.x, t.pos.z - e.fighter.pos.z, d.moveSpeed * 1.15, dt);
        return;
      }

      case 'attack':
        return this.runAttack(e, t, toYaw, dt);

      case 'recover':
        e.move(0, 0, dt);
        if (e.fighter.stateFrame >= d.recoverFrames) {
          e.releaseToken();
          e.resetCooldown();
          e.setState('circle');
        }
        return;

      case 'hitstun':
      case 'parried':
        e.move(0, 0, dt);
        if (--e.stunFrames <= 0) {
          e.resetCooldown(0.6);
          e.setState('circle');
        }
        return;

      case 'broken':
        e.move(0, 0, dt);
        if (!e.fighter.isBroken()) {
          e.resetCooldown(0.5);
          e.setState('circle');
        }
        return;
    }
  }

  /** 간격을 유지하며 옆으로 돈다. 쿨다운이 끝나면 토큰을 요청한다. */
  private circle(e: Enemy, t: Fighter, dist: number, toYaw: number, dt: number): void {
    const d = e.data;
    e.face(toYaw, d.turnSpeed, dt);
    if (d.retreatDistance && dist < d.retreatDistance) return e.setState('retreat');
    if (dist > d.keepDistance[1] + 2) return e.setState('approach');

    e.circleTimer -= dt;
    if (e.circleTimer <= 0) {
      e.circleTimer = randRange(1.2, 3);
      if (Math.random() < 0.4) e.circleDir *= -1;
    }
    // 옆걸음 + 간격 보정
    const side = toYaw + (Math.PI / 2) * e.circleDir;
    let rx = Math.sin(side), rz = Math.cos(side);
    const mid = (d.keepDistance[0] + d.keepDistance[1]) / 2;
    const radial = dist < d.keepDistance[0] ? -1 : dist > d.keepDistance[1] ? 1 : (dist - mid) * 0.3;
    rx += Math.sin(toYaw) * radial;
    rz += Math.cos(toYaw) * radial;
    e.moveDir(rx, rz, d.circleSpeed, dt);

    if (!t.alive) return;
    e.cooldown -= dt;
    if (e.cooldown > 0) return;
    const atk = this.choose(e, dist);
    if (!atk) return;
    if (e.requestToken()) {
      e.choice = atk;
      e.engageTime = 0;
      e.setState('engage');
    } else {
      e.cooldown = 0.4;
    }
  }

  private choose(e: Enemy, dist: number): EnemyAttack | null {
    const opts = e.data.attacks.filter(
      (a) => !a.minRange || dist >= a.minRange,
    ).filter((a) => !a.phase || a.phase <= e.phase);
    // 연속기 후속타는 단독으로 고르지 않는다
    const followUps = new Set(e.data.attacks.map((a) => a.next).filter(Boolean));
    const pool = opts.filter((a) => !followUps.has(a.id));
    if (!pool.length) return null;
    let r = Math.random() * pool.reduce((s, a) => s + a.weight, 0);
    for (const a of pool) if ((r -= a.weight) <= 0) return a;
    return pool[pool.length - 1];
  }

  private attack(e: Enemy, atk: EnemyAttack): void {
    e.startAttack(atk);
  }

  private runAttack(e: Enemy, t: Fighter, toYaw: number, dt: number): void {
    const f = e.fighter;
    const run = f.attack;
    if (!run) return e.setState('recover');
    // 예비 동작 동안에만 대상을 따라 돈다
    if (run.phase() === 'startup') e.face(toYaw, e.data.trackTurnSpeed, dt);
    const adv = run.tick();
    e.move(Math.sin(f.yaw) * adv, Math.cos(f.yaw) * adv, dt);
    const atk = e.choice;
    if (atk?.projectile) this.fireProjectiles(e, atk, run.frame, t);
    if (run.done()) {
      f.attack = null;
      const next = atk?.next ? e.findAttack(atk.next) : undefined;
      if (next && t.alive) return e.startAttack(next);
      e.choice = null;
      e.setState('recover');
    }
  }

  /** 궁수: 판정 시작 프레임부터 간격마다 화살을 쏜다 */
  private fireProjectiles(e: Enemy, atk: EnemyAttack, frame: number, t: Fighter): void {
    const p = atk.projectile!;
    const f = e.fighter;
    for (let i = 0; i < p.count; i++) {
      if (frame !== atk.startup + i * p.interval) continue;
      const yaw = e.yawTo(t);
      bus.emit('fireProjectile', {
        owner: f, attack: atk, spec: p,
        x: f.pos.x + Math.sin(yaw) * (f.radius + 0.3), y: f.pos.y + p.height, z: f.pos.z + Math.cos(yaw) * (f.radius + 0.3),
        dx: Math.sin(yaw), dy: 0, dz: Math.cos(yaw),
      });
    }
  }
}

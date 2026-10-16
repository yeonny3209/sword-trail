import * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { Fighter } from './Fighter';
import { sweepCapsule } from './sweep';
import type { HitSource } from './types';

export interface CombatData {
  hitRadius: number;
  parryWindowMs: number;
  blockAngleDeg: number;
  blockDamageMul: number;
  blockPostureMul: number;
  blockStaminaDefault: number;
  parryPostureDamage: number;
  parryPostureMul: number;
  finisherMultiplier: number;
  postureBreakSeconds: number;
  knockback: number;
}

/**
 * 판정과 피해 계산. 매 고정 단계마다 활성 판정을 모든 상대 캡슐에 쓸어서 검사하고,
 * 결과를 이벤트로만 알린다(피격 반응은 각 주인이 이벤트를 구독해서 처리).
 */
export class CombatSystem {
  readonly data = getData<CombatData>('combat');
  readonly fighters: Fighter[] = [];
  private frame = 0;
  private readonly point = new THREE.Vector3();

  constructor() {
    bus.on('fighterSpawned', ({ fighter }) => this.fighters.push(fighter));
    bus.on('fighterRemoved', ({ fighter }) => {
      const i = this.fighters.indexOf(fighter);
      if (i >= 0) this.fighters.splice(i, 1);
    });
  }

  update(frame: number, dt: number): void {
    this.frame = frame;
    for (const f of this.fighters) this.updatePosture(f, dt);

    const sources: HitSource[] = [];
    for (const f of this.fighters) if (f.alive && f.attack?.isActive()) sources.push(f.attack);

    for (const src of sources) {
      for (const target of this.fighters) {
        if (!target.alive || target.team === src.owner.team || src.hitList.has(target.id)) continue;
        const [a, b] = target.hurtCapsule();
        if (sweepCapsule(src.prevSeg, src.seg, src.radius, a, b, target.radius, this.point)) {
          src.hitList.add(target.id);
          this.resolve(src, target, this.point.clone());
          if (src.consumed) break;
        }
      }
    }
  }

  private resolve(src: HitSource, target: Fighter, point: THREE.Vector3): void {
    this.applyHit(src, target, point);
  }

  private applyHit(src: HitSource, target: Fighter, point: THREE.Vector3): void {
    const atk = src.data;
    const attacker = src.owner;
    const finisher = target.isBroken();
    let damage = atk.damage * attacker.mods.damageMul * attacker.mods.nextHitMul * target.mods.damageTakenMul;
    if (atk.heavy) damage *= attacker.mods.heavyDamageMul;
    if (finisher) damage *= this.data.finisherMultiplier;
    const postureDamage = finisher ? 0 : atk.posture * attacker.mods.postureMul;
    damage = Math.round(damage);

    const v = target.vitals;
    v.hp = Math.max(0, v.hp - damage);
    if (finisher) {
      target.brokenFrames = 0;
      v.posture = 0;
    } else {
      v.posture = Math.min(v.maxPosture, v.posture + postureDamage);
      target.lastPostureHitFrame = this.frame;
    }
    if (src.consumeOnContact) src.consumed = true;
    bus.emit('hit', { attacker, target, attack: atk, damage, postureDamage, point, finisher });

    if (v.hp <= 0) {
      target.alive = false;
      target.attack = null;
      bus.emit('death', { fighter: target, killer: attacker });
    } else if (!finisher && v.posture >= v.maxPosture) {
      this.breakPosture(target, false);
    }
  }

  private breakPosture(f: Fighter, guardBreak: boolean): void {
    if (f.isBroken()) return;
    f.vitals.posture = f.vitals.maxPosture;
    f.brokenFrames = Math.round(this.data.postureBreakSeconds * 60);
    f.attack = null;
    bus.emit('postureBreak', { fighter: f, guardBreak });
  }

  private updatePosture(f: Fighter, dt: number): void {
    if (!f.alive) return;
    if (f.brokenFrames > 0) {
      f.brokenFrames--;
      if (f.brokenFrames === 0) {
        f.vitals.posture = 0;
        bus.emit('postureRecovered', { fighter: f });
      }
      return;
    }
    if (this.frame - f.lastPostureHitFrame > f.postureRegenDelay * 60) {
      const mul = f.blocking ? 0.3 : 1;
      f.vitals.posture = Math.max(0, f.vitals.posture - f.postureRegen * mul * dt);
    }
  }
}

import * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { Physics } from '../core/Physics';
import type { Fighter } from './Fighter';
import { Projectiles } from './Projectiles';
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
  readonly projectiles: Projectiles;

  constructor(scene: THREE.Scene, physics: Physics) {
    this.projectiles = new Projectiles(scene, physics);
    bus.on('fighterSpawned', ({ fighter }) => this.fighters.push(fighter));
    bus.on('fighterRemoved', ({ fighter }) => {
      const i = this.fighters.indexOf(fighter);
      if (i >= 0) this.fighters.splice(i, 1);
    });
  }

  update(frame: number, dt: number): void {
    this.frame = frame;
    for (const f of this.fighters) this.updatePosture(f, dt);

    this.projectiles.update(dt);
    const sources: HitSource[] = [];
    for (const f of this.fighters) {
      // melee=false 공격(활 쏘기)은 검 판정이 없다
      if (f.alive && f.attack?.isActive() && f.attack.data.melee !== false) sources.push(f.attack);
    }
    for (const p of this.projectiles.list) if (p.isActive()) sources.push(p);

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
    this.projectiles.sweep();
  }

  /** 무적 → 회피, 막기 시작 직후 → 패링, 막기 중 → 막기, 그 외 → 피격 */
  private resolve(src: HitSource, target: Fighter, point: THREE.Vector3): void {
    const atk = src.data;
    const attacker = src.owner;
    if (target.iframe) {
      bus.emit('dodged', { attacker, defender: target, attack: atk });
      return;
    }
    if (target.blocking && atk.blockable !== false && this.facing(target, src.origin())) {
      const windowMs = this.data.parryWindowMs + target.mods.parryWindowBonusMs;
      const inWindow = this.frame - target.blockStartFrame <= Math.round((windowMs / 1000) * 60);
      if (src.consumeOnContact) src.consumed = true;
      if (inWindow && atk.parryable !== false) this.parry(src, target, point);
      else this.block(src, target, point);
      return;
    }
    this.applyHit(src, target, point);
  }

  private facing(target: Fighter, from: THREE.Vector3): boolean {
    const dx = from.x - target.pos.x, dz = from.z - target.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return true;
    const dot = (Math.sin(target.yaw) * dx + Math.cos(target.yaw) * dz) / len;
    return dot >= Math.cos((this.data.blockAngleDeg * Math.PI) / 180);
  }

  private parry(src: HitSource, defender: Fighter, point: THREE.Vector3): void {
    const attacker = src.owner;
    const v = attacker.vitals;
    if (!attacker.isBroken()) {
      v.posture = Math.min(v.maxPosture, v.posture + this.data.parryPostureDamage + src.data.posture * this.data.parryPostureMul);
      attacker.lastPostureHitFrame = this.frame;
    }
    bus.emit('parrySuccess', { attacker, defender, attack: src.data, point });
    if (attacker.alive && v.posture >= v.maxPosture) this.breakPosture(attacker, false);
  }

  private block(src: HitSource, defender: Fighter, point: THREE.Vector3): void {
    const atk = src.data;
    const v = defender.vitals;
    if (v.maxStamina > 0) v.stamina = Math.max(0, v.stamina - (atk.blockStamina ?? this.data.blockStaminaDefault));
    v.hp = Math.max(1, v.hp - Math.round(atk.damage * this.data.blockDamageMul));
    v.posture = Math.min(v.maxPosture, v.posture + atk.posture * this.data.blockPostureMul);
    defender.lastPostureHitFrame = this.frame;
    const guardBreak = (v.maxStamina > 0 && v.stamina <= 0) || v.posture >= v.maxPosture;
    bus.emit('blocked', { attacker: src.owner, defender, attack: atk, point, guardBreak });
    if (guardBreak) {
      defender.blocking = false;
      this.breakPosture(defender, true);
    }
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

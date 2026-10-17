import * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { HitDef } from '../../shared/types';
import type { QuarterCamera } from '../game/QuarterCamera';
import type { Effects } from './Effects';
import type { BurstSpec, Particles } from './Particles';

interface Juice {
  hitstopMul: number;
  hitstopMin: number;
  critStop: number;
  killStop: number;
  bossKillStop: number;
  shakeBase: number;
  shakePerStop: number;
  kickBase: number;
  kickPerStop: number;
  zoomPerStop: number;
}

const COLOR: Record<string, string> = { slash: '#cfe6ff', heavy: '#ffd890', pierce: '#e0f4ff', x: '#ff9070', magic: '#c4a0ff' };

/**
 * 때리는 맛 연출을 한곳에 모은다: 베기 자국, 맞은 자리 충격(별빛·불꽃), 소리, 화면 흔들림·반동, 치명타·처치 연출.
 * 수치는 data/fx.json의 juice·particles.
 */
export class HitFx {
  readonly juice = getData<{ juice: Juice }>('fx').juice;
  private readonly bursts = getData<{ particles: Record<string, BurstSpec> }>('fx').particles;
  private swingDir = 1;
  private readonly v = new THREE.Vector3();

  constructor(private readonly fx: Effects, private readonly particles: Particles, private readonly cam: QuarterCamera) {}

  /** 타격이 멈추는 프레임 수(원래 값을 키우고 최소 보장) */
  stopFrames(hit: HitDef, crit = false): number {
    return Math.max(this.juice.hitstopMin, Math.round(hit.stop * this.juice.hitstopMul)) + (crit ? this.juice.critStop : 0);
  }

  /** 휘두르는 순간 타격 모양대로 베기 자국을 남긴다(내 공격·다른 플레이어 공격 모두) */
  slash(x: number, y: number, z: number, yaw: number, hit: HitDef, first: boolean): void {
    const color = COLOR[hit.fx ?? 'slash'] ?? COLOR.slash;
    const s = hit.shape;
    if (first) this.swingDir = -this.swingDir;
    const cy = y + 1.0;
    if (s.type === 'box') this.fx.streak(x + Math.sin(yaw) * 0.4, cy, z + Math.cos(yaw) * 0.4, yaw, s.range, Math.max(0.12, s.width * 0.18), color);
    else if (s.type === 'circle') this.fx.ring(x + Math.sin(yaw) * (s.offset ?? 0), z + Math.cos(yaw) * (s.offset ?? 0), s.range * 0.55, color);
    else this.fx.slashArc(x, cy, z, yaw, s.range * 0.95, s.width, color, this.swingDir, hit.fx === 'heavy' ? 0.62 : 0.5);
  }

  /**
   * 맞았다: 충격 별빛·불꽃·소리·흔들림·반동. (dx, dz) = 때린 방향, mat = 맞은 재질
   * 돌려주는 값: 이 타격으로 멈출 프레임
   */
  landed(at: THREE.Vector3, dx: number, dz: number, hit: HitDef, mat: string): number {
    const strong = hit.stop >= 8;
    const size = 0.8 + hit.stop * 0.07;
    const hard = mat === 'metal' || mat === 'stone';
    const color = mat === 'slime' ? '#aaffb0' : hard ? '#d8f0ff' : COLOR[hit.fx ?? 'slash'] ?? '#ffd9a0';
    this.fx.impact(at.x, at.y, at.z, dx, dz, color, size);
    const dir = this.v.set(dx, 0.3, dz).normalize();
    const spec = mat === 'slime' ? this.bursts.goo : hard ? this.bursts.block : strong ? this.bursts.heavyHit : this.bursts.hit;
    this.particles.burst(at, spec, dir);
    if (mat === 'flesh' || mat === undefined) this.particles.burst(at, { ...this.bursts.blood, count: Math.round(this.bursts.blood.count * (strong ? 1 : 0.5)) }, dir);
    if (strong) this.fx.ring(at.x, at.z, 0.9, color);
    const stop = this.stopFrames(hit);
    const shake = Math.max(this.juice.shakeBase + hit.stop * this.juice.shakePerStop, (hit.shake ?? 0) * 1.6);
    this.cam.addShake(shake);
    this.cam.addKick(dx, dz, this.juice.kickBase + hit.stop * this.juice.kickPerStop, hit.stop * this.juice.zoomPerStop);
    bus.emit('sfx', { key: mat === 'metal' ? 'hitMetal' : mat === 'slime' ? 'hitSlime' : strong || mat === 'stone' ? 'hitHeavy' : 'hitFlesh' });
    return stop;
  }

  /** 치명타(서버가 확정해서 알려 준 뒤): 금빛 폭발 + 높은 소리 + 큰 흔들림 */
  crit(at: THREE.Vector3, dx: number, dz: number): void {
    this.fx.impact(at.x, at.y, at.z, dx, dz, '#ffd24a', 1.9);
    this.fx.flash(at.x, at.y, at.z, 1.6, '#ffe9a0');
    this.fx.ring(at.x, at.z, 1.1, '#ffd24a');
    this.particles.burst(at, this.bursts.crit, this.v.set(dx, 0.4, dz).normalize());
    this.cam.addShake(0.3);
    this.cam.addKick(dx, dz, 0.28, 0.05);
    bus.emit('sfx', { key: 'crit' });
  }

  /** 쓰러뜨렸다: 커다란 폭발과 묵직한 소리. 돌려주는 값: 멈출 프레임 */
  kill(at: THREE.Vector3, boss: boolean, mine: boolean): number {
    const size = boss ? 3.2 : 1.8;
    this.fx.impact(at.x, at.y, at.z, 0, 0, '#ff8a70', size);
    this.fx.flash(at.x, at.y, at.z, size * 1.2, '#ffd0c0');
    this.fx.ring(at.x, at.z, boss ? 2.4 : 1.3, '#ffb090');
    this.particles.burst(at, { ...this.bursts.finisher, count: boss ? 160 : this.bursts.finisher.count });
    if (mine) {
      this.cam.addShake(boss ? 0.6 : 0.3);
      this.cam.addKick(0, 1, boss ? 0.5 : 0.25, boss ? 0.08 : 0.04);
    }
    bus.emit('sfx', { key: 'kill', volume: mine ? 1 : 0.5 });
    return mine ? (boss ? this.juice.bossKillStop : this.juice.killStop) : 0;
  }
}

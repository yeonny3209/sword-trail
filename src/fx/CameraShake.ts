import type * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';

interface ShakeData {
  parry: number; finisher: number; guardBreak: number; playerHit: number;
  decay: number; frequency: number; maxOffset: number; maxRoll: number;
}

/**
 * 카메라 흔들림(트라우마 방식). 강공격·패링·결정타에서만 짧고 강하게.
 * 카메라 위치를 계산한 뒤 마지막에 덧붙인다.
 */
export class CameraShake {
  private readonly d = getData<{ shake: ShakeData }>('fx').shake;
  private trauma = 0;
  private time = 0;
  enabled = true;

  constructor() {
    const d = this.d;
    bus.on('hit', (e) => {
      if (e.finisher) this.add(d.finisher);
      else if (e.attack.shake) this.add(e.attack.shake);
      else if (e.target.team === 'player') this.add(d.playerHit);
    });
    bus.on('parrySuccess', () => this.add(d.parry));
    bus.on('bossPhase', () => this.add(d.finisher));
    bus.on('postureBreak', (e) => e.guardBreak && this.add(d.guardBreak));
  }

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  apply(camera: THREE.Camera, dt: number): void {
    if (this.trauma <= 0) return;
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - this.d.decay * dt);
    if (!this.enabled) return;
    const s = this.trauma * this.trauma;
    const f = this.d.frequency * this.time;
    const n = (k: number) => Math.sin(f * (1 + k * 0.37) + k * 11.3) * Math.sin(f * 0.71 * (1 + k * 0.21) + k * 3.1);
    camera.position.x += n(1) * this.d.maxOffset * s;
    camera.position.y += n(2) * this.d.maxOffset * s;
    camera.position.z += n(3) * this.d.maxOffset * s;
    camera.rotateZ(n(4) * this.d.maxRoll * s);
  }
}

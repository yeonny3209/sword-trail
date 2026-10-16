import * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import { CameraShake } from './CameraShake';
import { Hitstop } from './Hitstop';
import { Particles, type BurstSpec } from './Particles';
import { SwordTrails } from './SwordTrails';

interface FlashData { lightColor: string; lightIntensity: number; lightDistance: number; seconds: number; screenFlash: number }

/** 타격감 묶음. 전투 이벤트를 구독만 하고 전투 코드는 건드리지 않는다. */
export class FxSystem {
  readonly shake = new CameraShake();
  private readonly particles: Particles;
  private readonly trails: SwordTrails;
  private readonly light: THREE.PointLight;
  private readonly flashEl: HTMLDivElement;
  private readonly flash: FlashData;
  private lightTime = 0;

  constructor(scene: THREE.Scene, ui: HTMLElement) {
    new Hitstop();
    this.particles = new Particles(scene);
    this.trails = new SwordTrails(scene);
    const fx = getData<{ particles: Record<string, BurstSpec>; parryFlash: FlashData }>('fx');
    this.flash = fx.parryFlash;
    this.light = new THREE.PointLight(this.flash.lightColor, 0, this.flash.lightDistance);
    scene.add(this.light);
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'screen-flash';
    ui.appendChild(this.flashEl);

    const p = fx.particles;
    const dirFrom = (from: THREE.Vector3, to: THREE.Vector3) => new THREE.Vector3().subVectors(to, from).setY(0).normalize();
    bus.on('hit', (e) => {
      const dir = dirFrom(e.attacker.pos, e.target.pos);
      this.particles.burst(e.point, e.finisher ? p.finisher : e.attack.heavy ? p.heavyHit : p.hit, dir);
    });
    bus.on('blocked', (e) => this.particles.burst(e.point, p.block, dirFrom(e.defender.pos, e.attacker.pos)));
    bus.on('parrySuccess', (e) => {
      this.particles.burst(e.point, p.parry);
      this.light.position.copy(e.point);
      this.lightTime = this.flash.seconds;
      this.screenFlash(this.flash.screenFlash);
    });
  }

  private screenFlash(opacity: number): void {
    const el = this.flashEl;
    el.style.transition = 'none';
    el.style.opacity = String(opacity);
    void el.offsetWidth;
    el.style.transition = `opacity ${this.flash.seconds * 2}s ease-out`;
    el.style.opacity = '0';
  }

  render(camera: THREE.Camera, alpha: number, realDt: number, frozen: boolean): void {
    this.trails.update(alpha, realDt, frozen);
    this.particles.update(realDt);
    if (this.lightTime > 0) {
      this.lightTime = Math.max(0, this.lightTime - realDt);
      this.light.intensity = this.flash.lightIntensity * (this.lightTime / this.flash.seconds);
    } else {
      this.light.intensity = 0;
    }
    this.shake.apply(camera, realDt);
  }
}

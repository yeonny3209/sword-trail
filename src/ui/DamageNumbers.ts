import * as THREE from 'three';
import { bus } from '../core/bus';

interface Pop {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  dx: number;
  big: boolean;
}

/**
 * 데미지 숫자(위로 떠오르며 사라짐)와 콤보 카운터.
 * kind: n 일반 / c 치명타 / p 내가 맞음 / o 다른 사람이 때림 / heal 회복 / exp
 */
export class DamageNumbers {
  private readonly layer: HTMLDivElement;
  private readonly pops: Pop[] = [];
  private readonly v = new THREE.Vector3();
  private readonly combo: HTMLDivElement;
  private comboN = 0;
  private comboT = 0;
  private readonly streakEl: HTMLDivElement;
  private streakT = 0;

  constructor(ui: HTMLElement, private readonly camera: THREE.Camera) {
    this.layer = document.createElement('div');
    this.layer.className = 'dmg-layer';
    ui.appendChild(this.layer);
    this.combo = document.createElement('div');
    this.combo.className = 'combo';
    ui.appendChild(this.combo);
    this.streakEl = document.createElement('div');
    this.streakEl.className = 'streak';
    ui.appendChild(this.streakEl);
    bus.on('streak', ({ n }) => {
      this.streakEl.innerHTML = `<b>${n}</b> KILL${n >= 10 ? '!!' : n >= 5 ? '!' : ''}`;
      this.streakEl.className = `streak on t${n >= 10 ? 3 : n >= 5 ? 2 : 1}`;
      this.streakT = 2.2;
      this.streakEl.style.animation = 'none';
      void this.streakEl.offsetWidth;
      this.streakEl.style.animation = '';
      bus.emit('sfx', { key: n >= 5 ? 'finisher' : 'gate', volume: 0.5 });
    });
  }

  /** value: 피해량이면 클수록 숫자를 키운다 */
  add(pos: THREE.Vector3, text: string, kind: string, extra = '', value = 0): void {
    const el = document.createElement('div');
    el.className = `dmg ${kind}`;
    if (value > 0 && (kind === 'n' || kind === 'c' || kind === 'p' || kind === 'o')) {
      const base = kind === 'c' ? 40 : kind === 'o' ? 20 : 30;
      el.style.fontSize = `${Math.round(base + Math.min(kind === 'c' ? 26 : 18, Math.sqrt(value) * 1.6))}px`;
    }
    el.innerHTML = extra ? `<small>${extra}</small>${text}` : text;
    this.layer.appendChild(el);
    this.pops.push({ el, pos: pos.clone(), t: 0, dx: (Math.random() - 0.5) * 56, big: kind === 'c' });
    if (this.pops.length > 60) this.pops.shift()?.el.remove();
  }

  /** 내가 때린 횟수: 1.6초 안에 이어지면 콤보 */
  hit(): void {
    this.comboN = this.comboT > 0 ? this.comboN + 1 : 1;
    this.comboT = 1.6;
    if (this.comboN >= 2) {
      this.combo.innerHTML = `<b>${this.comboN}</b> HIT`;
      const tier = this.comboN >= 30 ? 4 : this.comboN >= 15 ? 3 : this.comboN >= 6 ? 2 : 1;
      this.combo.className = `combo t${tier}`;
      this.combo.classList.remove('pop');
      void this.combo.offsetWidth;
      this.combo.classList.add('pop');
      this.combo.style.opacity = '1';
    }
  }

  render(dt: number): void {
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      if (p.t > 0.95) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      this.v.copy(p.pos).project(this.camera);
      // 위로 튀어 오르다 느려짐(처음엔 빠르게). 나타날 때 크게 터졌다가 줄어듦
      const rise = 24 + (1 - Math.exp(-p.t * 5)) * 70;
      const t0 = p.big ? 0.14 : 0.1;
      const pop = p.t < t0 ? (p.big ? 2.4 : 2.0) - (p.t / t0) * (p.big ? 1.4 : 1.0) : 1 + Math.max(0, 0.12 - (p.t - t0)) * 0.8;
      p.el.style.transform = `translate(${((this.v.x + 1) / 2) * w + p.dx}px, ${((1 - this.v.y) / 2) * h - rise}px) translate(-50%, -50%) scale(${pop})`;
      p.el.style.opacity = String(p.t > 0.6 ? 1 - (p.t - 0.6) / 0.35 : 1);
    }
    if (this.streakT > 0) {
      this.streakT -= dt;
      if (this.streakT <= 0) this.streakEl.classList.remove('on');
    }
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo.style.opacity = '0';
    }
  }
}

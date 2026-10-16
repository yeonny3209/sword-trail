import * as THREE from 'three';

interface Pop {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  dx: number;
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

  constructor(ui: HTMLElement, private readonly camera: THREE.Camera) {
    this.layer = document.createElement('div');
    this.layer.className = 'dmg-layer';
    ui.appendChild(this.layer);
    this.combo = document.createElement('div');
    this.combo.className = 'combo';
    ui.appendChild(this.combo);
  }

  add(pos: THREE.Vector3, text: string, kind: string, extra = ''): void {
    const el = document.createElement('div');
    el.className = `dmg ${kind}`;
    el.innerHTML = extra ? `<small>${extra}</small>${text}` : text;
    this.layer.appendChild(el);
    this.pops.push({ el, pos: pos.clone(), t: 0, dx: (Math.random() - 0.5) * 30 });
    if (this.pops.length > 60) this.pops.shift()?.el.remove();
  }

  /** 내가 때린 횟수: 1.6초 안에 이어지면 콤보 */
  hit(): void {
    this.comboN = this.comboT > 0 ? this.comboN + 1 : 1;
    this.comboT = 1.6;
    if (this.comboN >= 2) {
      this.combo.innerHTML = `<b>${this.comboN}</b> HIT`;
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
      const rise = 30 + p.t * 70;
      const pop = p.t < 0.08 ? 1.5 - p.t * 6 : 1;
      p.el.style.transform = `translate(${((this.v.x + 1) / 2) * w + p.dx}px, ${((1 - this.v.y) / 2) * h - rise}px) translate(-50%, -50%) scale(${pop})`;
      p.el.style.opacity = String(p.t > 0.6 ? 1 - (p.t - 0.6) / 0.35 : 1);
    }
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo.style.opacity = '0';
    }
  }
}

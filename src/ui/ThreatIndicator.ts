import * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { Fighter } from '../combat/Fighter';
import type { Glow } from '../combat/types';

interface Threat {
  fighter: Fighter;
  el: HTMLDivElement;
}

/** 화면 밖에서 공격하려는 적을 화면 가장자리에 표시한다. */
export class ThreatIndicator {
  private threats: Threat[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly colors = getData<{ glowColors: Record<Glow, string> }>('combat').glowColors;

  constructor(ui: HTMLElement, private readonly camera: THREE.Camera) {
    bus.on('telegraph', ({ fighter, attack }) => {
      if (this.threats.some((t) => t.fighter === fighter)) return;
      const el = document.createElement('div');
      el.className = 'threat';
      el.style.setProperty('--c', attack.glow === 'white' ? '#ff6a4a' : this.colors[attack.glow ?? 'red']);
      ui.appendChild(el);
      this.threats.push({ fighter, el });
    });
  }

  render(): void {
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.threats.length - 1; i >= 0; i--) {
      const { fighter: f, el } = this.threats[i];
      const run = f.attack;
      if (!f.alive || !run || run.phase() !== 'startup') {
        el.remove();
        this.threats.splice(i, 1);
        continue;
      }
      this.tmp.set(f.pos.x, f.pos.y + 1, f.pos.z).applyMatrix4(this.camera.matrixWorldInverse);
      const behind = this.tmp.z > 0;
      this.tmp.set(f.pos.x, f.pos.y + 1, f.pos.z).project(this.camera);
      let x = this.tmp.x, y = this.tmp.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const onScreen = !behind && Math.abs(x) < 0.95 && Math.abs(y) < 0.95;
      el.style.display = onScreen ? 'none' : '';
      if (onScreen) continue;
      const m = Math.max(Math.abs(x), Math.abs(y)) || 1;
      const ex = (x / m) * 0.92, ey = (y / m) * 0.88;
      const ang = Math.atan2(-ey, ex);
      el.style.transform = `translate(${((ex + 1) / 2) * w}px, ${((1 - ey) / 2) * h}px) translate(-50%, -50%) rotate(${ang}rad)`;
    }
  }
}

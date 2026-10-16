import * as THREE from 'three';
import { bus } from '../core/bus';
import type { Fighter } from '../combat/Fighter';

interface Bar {
  fighter: Fighter;
  el: HTMLDivElement;
  hp: HTMLDivElement;
  posture: HTMLDivElement;
  shownUntil: number;
}

/** 적 머리 위 체력·자세 게이지와 고정 표시 */
export class EnemyBars {
  private bars = new Map<number, Bar>();
  private lock: Fighter | null = null;
  private time = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly marker: HTMLDivElement;
  /** 화면 아래 큰 바로 따로 그리는 대상(보스) */
  private readonly skip = new Set<string>();

  constructor(ui: HTMLElement, private readonly camera: THREE.Camera) {
    this.marker = document.createElement('div');
    this.marker.className = 'lock-marker';
    ui.appendChild(this.marker);
    bus.on('fighterSpawned', ({ fighter }) => {
      if (fighter.team !== 'enemy' || this.skip.has(fighter.kind)) return;
      const el = document.createElement('div');
      el.className = 'enemy-bar';
      el.innerHTML = '<div class="name"></div><div class="hp"><div></div></div><div class="po"><div></div></div>';
      (el.querySelector('.name') as HTMLDivElement).textContent = fighter.name;
      ui.appendChild(el);
      this.bars.set(fighter.id, {
        fighter, el,
        hp: el.querySelector('.hp div') as HTMLDivElement,
        posture: el.querySelector('.po div') as HTMLDivElement,
        shownUntil: 0,
      });
    });
    bus.on('fighterRemoved', ({ fighter }) => {
      this.bars.get(fighter.id)?.el.remove();
      this.bars.delete(fighter.id);
    });
    const show = (f: Fighter) => {
      const b = this.bars.get(f.id);
      if (b) b.shownUntil = this.time + 4;
    };
    bus.on('hit', (e) => show(e.target));
    bus.on('parrySuccess', (e) => show(e.attacker));
    bus.on('lockChanged', ({ target }) => (this.lock = target));
  }

  skipKind(kind: string): void {
    this.skip.add(kind);
  }

  render(realDt: number): void {
    this.time += realDt;
    const w = window.innerWidth, h = window.innerHeight;
    for (const b of this.bars.values()) {
      const f = b.fighter;
      const visible = f.alive && (this.time < b.shownUntil || f === this.lock || f.isBroken() || f.vitals.posture > 1);
      this.tmp.set(f.pos.x, f.pos.y + f.height + 0.35, f.pos.z).project(this.camera);
      if (!visible || this.tmp.z > 1 || Math.abs(this.tmp.x) > 1.1 || Math.abs(this.tmp.y) > 1.1) {
        b.el.style.display = 'none';
        continue;
      }
      b.el.style.display = '';
      b.el.style.transform = `translate(${((this.tmp.x + 1) / 2) * w}px, ${((1 - this.tmp.y) / 2) * h}px) translate(-50%, -100%)`;
      b.hp.style.width = `${(f.vitals.hp / f.vitals.maxHp) * 100}%`;
      b.posture.style.width = `${(f.vitals.posture / f.vitals.maxPosture) * 100}%`;
      b.el.classList.toggle('broken', f.isBroken());
    }
    const t = this.lock;
    if (t && t.alive) {
      this.tmp.set(t.pos.x, t.pos.y + t.height * 0.6, t.pos.z).project(this.camera);
      this.marker.style.display = this.tmp.z < 1 ? '' : 'none';
      this.marker.style.transform = `translate(${((this.tmp.x + 1) / 2) * w}px, ${((1 - this.tmp.y) / 2) * h}px) translate(-50%, -50%)`;
      this.marker.classList.toggle('broken', t.isBroken());
    } else {
      this.marker.style.display = 'none';
    }
  }
}

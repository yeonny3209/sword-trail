import * as THREE from 'three';

interface Plate {
  obj: THREE.Object3D;
  height: number;
  el: HTMLDivElement;
  hp?: HTMLDivElement;
  maxDist: number;
}

/** 머리 위 이름표(플레이어·NPC·포탈·몬스터). 3D 위치를 화면 좌표로 옮겨 HTML로 그린다 */
export class Nameplates {
  private readonly layer: HTMLDivElement;
  private readonly plates = new Map<string, Plate>();
  private readonly v = new THREE.Vector3();
  visible = true;

  constructor(ui: HTMLElement, private readonly camera: THREE.Camera) {
    this.layer = document.createElement('div');
    this.layer.className = 'plates';
    ui.appendChild(this.layer);
  }

  /** kind: CSS 클래스(player, self, npc, portal, monster) */
  add(key: string, obj: THREE.Object3D, height: number, html: string, kind: string, withHp = false, maxDist = 60): void {
    this.remove(key);
    const el = document.createElement('div');
    el.className = `plate ${kind}`;
    el.innerHTML = `<div class="nm">${html}</div>`;
    let hp: HTMLDivElement | undefined;
    if (withHp) {
      const bar = document.createElement('div');
      bar.className = 'hpbar';
      hp = document.createElement('div');
      bar.appendChild(hp);
      el.appendChild(bar);
    }
    this.layer.appendChild(el);
    this.plates.set(key, { obj, height, el, hp, maxDist });
  }

  /** 플레이어·NPC 이름 보이기(몬스터 이름표·체력은 그대로) */
  setNames(on: boolean): void {
    this.layer.classList.toggle('nonames', !on);
  }

  setHtml(key: string, html: string): void {
    const p = this.plates.get(key);
    const nm = p?.el.querySelector('.nm');
    if (nm) nm.innerHTML = html;
  }

  setHp(key: string, ratio: number): void {
    const p = this.plates.get(key);
    if (p?.hp) p.hp.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  remove(key: string): void {
    this.plates.get(key)?.el.remove();
    this.plates.delete(key);
  }

  clear(prefix = ''): void {
    for (const k of [...this.plates.keys()]) if (k.startsWith(prefix)) this.remove(k);
  }

  render(): void {
    this.layer.style.display = this.visible ? '' : 'none';
    if (!this.visible) return;
    const w = window.innerWidth, h = window.innerHeight;
    const cam = this.camera.position;
    for (const p of this.plates.values()) {
      p.obj.getWorldPosition(this.v);
      const far = this.v.distanceTo(cam) > p.maxDist + 25;
      this.v.y += p.height;
      this.v.project(this.camera);
      if (far || this.v.z > 1 || Math.abs(this.v.x) > 1.2 || Math.abs(this.v.y) > 1.2) {
        p.el.style.display = 'none';
        continue;
      }
      p.el.style.display = '';
      p.el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }
}

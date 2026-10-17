import type { ZoneDef } from '../../shared/types';

export interface MapDot {
  x: number;
  z: number;
  kind: 'monster' | 'boss' | 'player' | 'npc' | 'node';
}

const COLORS: Record<MapDot['kind'], string> = {
  monster: '#ff5a4a', boss: '#ff2a8a', player: '#5ab0ff', npc: '#ffd860', node: '#6fe08f',
};

/** 오른쪽 위 미니맵: 존 전체를 축소해서 벽·포탈·NPC·몬스터·플레이어를 점으로 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly title: HTMLDivElement;
  private zone: ZoneDef | null = null;
  private t = 0;
  private lastRot = 0;
  private readonly size = 168;

  constructor(ui: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.className = 'minimap';
    this.title = document.createElement('div');
    this.title.className = 'mm-title';
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size * 2;
    this.canvas.style.width = this.canvas.style.height = `${this.size}px`;
    wrap.append(this.title, this.canvas);
    ui.appendChild(wrap);
    this.ctx = this.canvas.getContext('2d')!;
  }

  setZone(z: ZoneDef): void {
    this.zone = z;
    this.title.textContent = z.name;
  }

  /** 0.15초마다(카메라가 돌 때는 바로) 다시 그린다. rot: 카메라 각도 — 지도를 화면 방향에 맞게 돌린다 */
  render(dt: number, me: { x: number; z: number; yaw: number } | null, dots: MapDot[], rot = 0): void {
    this.t -= dt;
    const z = this.zone;
    if ((this.t > 0 && rot === this.lastRot) || !z || !me) return;
    this.t = 0.15;
    this.lastRot = rot;
    const c = this.ctx, S = this.size * 2;
    const scale = (S - 16) / Math.max(z.size[0], z.size[1]);
    const px = (x: number) => S / 2 + x * scale, pz = (v: number) => S / 2 + v * scale;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(10,12,16,.72)';
    c.fillRect(0, 0, S, S);
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(rot);
    c.translate(-S / 2, -S / 2);
    c.fillStyle = 'rgba(255,255,255,.06)';
    c.fillRect(px(-z.size[0] / 2), pz(-z.size[1] / 2), z.size[0] * scale, z.size[1] * scale);
    c.fillStyle = '#6a6a72';
    for (const w of z.walls) c.fillRect(px(w.x - w.w / 2), pz(w.z - w.d / 2), Math.max(2, w.w * scale), Math.max(2, w.d * scale));
    for (const p of z.portals) {
      c.strokeStyle = '#60d8ff';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(px(p.x), pz(p.z), 7, 0, Math.PI * 2);
      c.stroke();
    }
    for (const d of dots) {
      c.fillStyle = COLORS[d.kind];
      const r = d.kind === 'boss' ? 7 : d.kind === 'node' ? 3 : 4;
      c.beginPath();
      c.arc(px(d.x), pz(d.z), r, 0, Math.PI * 2);
      c.fill();
    }
    // 나: 바라보는 쪽 삼각형
    c.save();
    c.translate(px(me.x), pz(me.z));
    c.rotate(-me.yaw + Math.PI);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, -10);
    c.lineTo(7, 7);
    c.lineTo(-7, 7);
    c.closePath();
    c.fill();
    c.restore();
    c.restore();
  }
}

/** 화면 위 보스 체력 바(가까이 있는 보스만) */
export class BossBar {
  private readonly el: HTMLDivElement;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'bossbar';
    this.el.style.display = 'none';
    ui.appendChild(this.el);
  }

  show(name: string, lv: number, hp: number, mhp: number): void {
    this.el.style.display = '';
    const pct = Math.max(0, hp / mhp) * 100;
    this.el.innerHTML = `<div class="bn">Lv${lv} ${name}</div><div class="bb"><div class="bf" style="width:${pct}%"></div><span>${Math.max(0, Math.round(hp)).toLocaleString()} / ${mhp.toLocaleString()}</span></div>`;
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}

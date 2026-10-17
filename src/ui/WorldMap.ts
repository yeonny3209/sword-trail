import { MONSTERS } from '../../shared/data';
import type { ZoneDef } from '../../shared/types';
import type { MapDot } from './Minimap';

/**
 * 큰 지도(Tab): 지금 존 전체를 북쪽이 위로 크게 보여 준다. 사냥터 이름·레벨, NPC·포탈 이름, 채집 노드, 다른 플레이어.
 * 지도를 누르면 그곳으로 자동 이동(onPick).
 */
export class WorldMap {
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private zone: ZoneDef | null = null;
  private scale = 1;
  private size = 600;
  private t = 0;
  onPick: (x: number, z: number) => void = () => {};

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'worldmap';
    this.el.style.display = 'none';
    this.el.innerHTML = '<div class="wm-box"><div class="wm-head"><b></b><small>누르면 그곳으로 자동 이동 · Tab/Esc 닫기</small></div><canvas></canvas><div class="wm-legend"><i style="background:#ff5a4a"></i>몬스터 <i style="background:#ff2a8a"></i>보스·정예 <i style="background:#ffd860"></i>NPC <i style="background:#60d8ff"></i>포탈 <i style="background:#6fe08f"></i>채집 <i style="background:#5ab0ff"></i>플레이어</div></div>';
    ui.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) return this.toggle(false);
      if (e.target !== this.canvas || !this.zone) return;
      const r = this.canvas.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      const px = ((e.clientX - r.left) / r.width) * this.size, pz = ((e.clientY - r.top) / r.height) * this.size;
      const x = (px - this.size / 2) / this.scale, z = (pz - this.size / 2) / this.scale;
      const [hw, hd] = [this.zone.size[0] / 2, this.zone.size[1] / 2];
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > hw || Math.abs(z) > hd) return;
      this.onPick(x, z);
      this.toggle(false);
    });
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  toggle(on = !this.isOpen): void {
    this.el.style.display = on ? '' : 'none';
  }

  setZone(z: ZoneDef): void {
    this.zone = z;
    this.el.querySelector('.wm-head b')!.textContent = `${z.name}${z.type === 'field' ? ` (Lv ${z.level[0]}~${z.level[1]})` : ''}`;
  }

  render(dt: number, me: { x: number; z: number; yaw: number }, dots: MapDot[], dest: { x: number; z: number } | null): void {
    const z = this.zone;
    if (!this.isOpen || !z) return;
    this.t += dt;
    const S = (this.size = Math.round(Math.min(window.innerWidth * 0.8, window.innerHeight * 0.74, 760)) * 2);
    if (this.canvas.width !== S) {
      this.canvas.width = this.canvas.height = S;
      this.canvas.style.width = this.canvas.style.height = `${S / 2}px`;
    }
    const c = this.ctx;
    const scale = (this.scale = (S - 40) / Math.max(z.size[0], z.size[1]));
    const px = (x: number) => S / 2 + x * scale, pz = (v: number) => S / 2 + v * scale;
    c.clearRect(0, 0, S, S);
    c.fillStyle = z.ground;
    c.globalAlpha = 0.85;
    c.fillRect(px(-z.size[0] / 2), pz(-z.size[1] / 2), z.size[0] * scale, z.size[1] * scale);
    c.globalAlpha = 1;
    c.fillStyle = 'rgba(0,0,0,.25)';
    c.fillRect(px(-z.size[0] / 2), pz(-z.size[1] / 2), z.size[0] * scale, z.size[1] * scale);
    c.fillStyle = '#3a3a44';
    for (const w of z.walls) c.fillRect(px(w.x - w.w / 2), pz(w.z - w.d / 2), Math.max(3, w.w * scale), Math.max(3, w.d * scale));
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const label = (text: string, x: number, y: number, color: string, size = 22) => {
      c.font = `700 ${size}px sans-serif`;
      c.lineWidth = 5;
      c.strokeStyle = 'rgba(0,0,0,.8)';
      c.strokeText(text, x, y);
      c.fillStyle = color;
      c.fillText(text, x, y);
    };
    // 사냥터 구역
    for (const s of z.spawns) {
      const def = MONSTERS[s.monster];
      if (!def) continue;
      c.fillStyle = def.boss ? 'rgba(255,40,140,.16)' : 'rgba(255,90,70,.12)';
      c.fillRect(px(s.area.x - s.area.w / 2), pz(s.area.z - s.area.d / 2), s.area.w * scale, s.area.d * scale);
      label(`${def.name} Lv${def.lv}`, px(s.area.x), pz(s.area.z), def.boss ? '#ff9ad0' : '#ffc0b0', 20);
    }
    for (const d of dots) {
      if (d.kind === 'npc') continue;
      c.fillStyle = ({ monster: '#ff5a4a', boss: '#ff2a8a', player: '#5ab0ff', npc: '#ffd860', node: '#6fe08f' } as const)[d.kind];
      c.beginPath();
      c.arc(px(d.x), pz(d.z), d.kind === 'boss' ? 9 : d.kind === 'node' ? 5 : 6, 0, Math.PI * 2);
      c.fill();
    }
    for (const n of z.npcs) {
      c.fillStyle = '#ffd860';
      c.beginPath();
      c.arc(px(n.x), pz(n.z), 8, 0, Math.PI * 2);
      c.fill();
      label(n.name, px(n.x), pz(n.z) - 22, '#ffe9a0', 19);
    }
    for (const p of z.portals) {
      c.strokeStyle = '#60d8ff';
      c.lineWidth = 5;
      c.beginPath();
      c.arc(px(p.x), pz(p.z), 13, 0, Math.PI * 2);
      c.stroke();
      label(p.label, px(Math.max(-z.size[0] / 2 + 12, Math.min(z.size[0] / 2 - 12, p.x))), pz(p.z) + (p.z > 0 ? -28 : 28), '#a8ecff', 19);
    }
    if (dest) {
      c.strokeStyle = '#7fe0ff';
      c.lineWidth = 4;
      c.setLineDash([10, 8]);
      c.beginPath();
      c.moveTo(px(me.x), pz(me.z));
      c.lineTo(px(dest.x), pz(dest.z));
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      c.arc(px(dest.x), pz(dest.z), 10 + Math.sin(this.t * 6) * 3, 0, Math.PI * 2);
      c.stroke();
    }
    c.save();
    c.translate(px(me.x), pz(me.z));
    c.rotate(-me.yaw + Math.PI);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#000';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, -16);
    c.lineTo(11, 11);
    c.lineTo(-11, 11);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }
}

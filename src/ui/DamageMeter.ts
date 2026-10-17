import { bus } from '../core/bus';
import { CLASS_BY_ID } from '../../shared/data';
import type { ClassId } from '../../shared/types';

interface Row { id: number; name: string; cls: ClassId | null; dmg: number; heal: number }

/**
 * 피해량 측정기(H): 이 지역에서 나와 다른 플레이어가 몬스터에게 준 피해·치유를 모은다.
 * 전투가 10초 끊기면 다음 피해부터 새로 센다. 초당 피해(DPS)는 전투 시간으로 나눈 값.
 */
export class DamageMeter {
  private readonly el: HTMLDivElement;
  private rows = new Map<number, Row>();
  private start = 0;
  private last = 0;
  private drawT = 0;
  names: (id: number) => { name: string; cls: ClassId } | null = () => null;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dmg-meter';
    this.el.style.display = 'none';
    ui.appendChild(this.el);
    bus.on('net', (m) => {
      if (m.t === 'dmg' && m.tk === 'm' && m.by) this.add(m.by, m.n, 0);
      else if (m.t === 'heal' && m.by) this.add(m.by, 0, m.n);
      else if (m.t === 'welcome') this.reset();
    });
  }

  toggle(): void {
    this.el.style.display = this.el.style.display === 'none' ? '' : 'none';
    this.draw();
  }

  reset(): void {
    this.rows.clear();
    this.start = this.last = 0;
    this.draw();
  }

  private add(id: number, dmg: number, heal: number): void {
    const now = performance.now();
    if (now - this.last > 10_000) {
      this.rows.clear();
      this.start = now;
    }
    this.last = now;
    let r = this.rows.get(id);
    if (!r) {
      const who = this.names(id);
      r = { id, name: who?.name ?? `#${id}`, cls: who?.cls ?? null, dmg: 0, heal: 0 };
      this.rows.set(id, r);
    }
    r.dmg += dmg;
    r.heal += heal;
  }

  /** 렌더 프레임: 0.5초마다 다시 그림 */
  render(dt: number): void {
    this.drawT -= dt;
    if (this.drawT > 0 || this.el.style.display === 'none') return;
    this.drawT = 0.5;
    this.draw();
  }

  private draw(): void {
    if (this.el.style.display === 'none') return;
    const secs = Math.max(1, (this.last - this.start) / 1000);
    const list = [...this.rows.values()].sort((a, b) => b.dmg - a.dmg).slice(0, 6);
    const top = list[0]?.dmg || 1;
    const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
    this.el.innerHTML = `<div class="dm-head">피해량 <small>H · ${secs.toFixed(0)}초</small><button class="dm-reset" title="초기화">↺</button></div>${list.length ? list.map((r) => `
      <div class="dm-row"><div class="dm-fill" style="width:${(r.dmg / top) * 100}%;background:${r.cls ? CLASS_BY_ID[r.cls].color : '#888'}"></div>
      <span>${r.name}</span><b>${fmt(r.dmg)} <small>(${fmt(r.dmg / secs)}/초${r.heal ? ` · 치유 ${fmt(r.heal)}` : ''})</small></b></div>`).join('') : '<div class="dm-empty">몬스터를 때리면 기록됩니다</div>'}`;
    this.el.querySelector('.dm-reset')?.addEventListener('click', () => this.reset());
  }
}

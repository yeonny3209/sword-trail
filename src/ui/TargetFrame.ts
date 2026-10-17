import { bus } from '../core/bus';
import { STATUS } from '../../shared/status';
import type { Monsters } from '../game/Monsters';

const MAT: Record<string, string> = { flesh: '살', metal: '금속', slime: '젤리', stone: '돌' };

/** 대상 정보창: 마지막으로 때린 몬스터의 이름·레벨·체력(숫자)·디버프·특징. 8초 동안 안 때리면 사라진다 */
export class TargetFrame {
  private readonly el: HTMLDivElement;
  private id = 0;
  private at = 0;
  private lastHtml = '';

  constructor(ui: HTMLElement, private readonly monsters: Monsters) {
    this.el = document.createElement('div');
    this.el.className = 'target-frame';
    this.el.style.display = 'none';
    ui.appendChild(this.el);
    bus.on('target', ({ id }) => {
      this.id = id;
      this.at = performance.now();
    });
  }

  render(myLv: number): void {
    const v = this.id ? this.monsters.list.get(this.id) : undefined;
    if (!v || v.dying || performance.now() - this.at > 8000) {
      this.el.style.display = 'none';
      this.lastHtml = '';
      return;
    }
    const d = v.def;
    const diff = d.lv - myLv;
    const lvCls = diff >= 5 ? 'hard' : diff <= -6 ? 'easy' : '';
    const tags = [d.boss ? '보스' : '', d.elite ? '정예' : '', d.superArmor ? '강인함(경직 없음)' : '', d.weight >= 2.5 ? '무거움(잘 안 뜸)' : d.weight <= 0.9 ? '가벼움(잘 뜸)' : '', MAT[d.hitMat ?? 'flesh']].filter(Boolean);
    const icons = v.status.map((s) => `<span title="${STATUS[s]?.name ?? s}">${STATUS[s]?.icon ?? ''}</span>`).join('');
    const pct = Math.max(0, v.hp / v.mhp) * 100;
    const html = `<div class="tf-name"><span class="tf-lv ${lvCls}">Lv${d.lv}</span> ${d.name} ${icons}</div>
      <div class="tf-bar"><div class="tf-fill" style="width:${pct}%"></div><span>${Math.max(0, Math.round(v.hp)).toLocaleString()} / ${v.mhp.toLocaleString()} (${pct.toFixed(0)}%)</span></div>
      <div class="tf-tags">${tags.join(' · ')}</div>`;
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
    this.el.style.display = '';
  }
}

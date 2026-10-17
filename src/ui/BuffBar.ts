import { bus } from '../core/bus';
import { BOND, STATUS, type BuffView } from '../../shared/status';

/** 내 체력 막대 아래: 걸려 있는 버프·디버프 아이콘과 남은 시간 */
export class BuffBar {
  private readonly el: HTMLDivElement;
  private list: BuffView[] = [];
  private at = 0;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'buffbar';
    ui.appendChild(this.el);
    bus.on('net', (m) => {
      if (m.t === 'buffs') {
        this.list = m.list;
        this.at = performance.now();
        this.draw();
      } else if (m.t === 'welcome' || m.t === 'died') {
        this.list = [];
        this.draw();
      }
    });
    setInterval(() => this.draw(), 500);
  }

  private tip(b: BuffView): string {
    const s = STATUS[b.id];
    if (b.id === 'bond') return `${s.name}: 가까운 파티원 ${b.power}명 — 공격력 +${Math.round(BOND.atk * b.power * 100)}%, 방어력 +${Math.round(BOND.def * b.power * 100)}%`;
    const extra = b.id === 'shield' ? ` (남은 보호막 ${Math.round(b.val ?? 0)})` : '';
    return `${s.name}: ${s.desc.replace('{p}', String(Math.round(b.power * 100)))}${extra}`;
  }

  private draw(): void {
    const now = performance.now();
    this.el.innerHTML = this.list
      .map((b) => ({ b, left: b.left - (now - this.at) }))
      .filter((x) => x.b.id === 'bond' || x.left > 0)
      .map(({ b, left }) => `<div class="bf ${STATUS[b.id].debuff ? 'bad' : ''}" title="${this.tip(b)}"><span>${STATUS[b.id].icon}</span><small>${b.id === 'bond' ? `×${b.power}` : `${Math.ceil(left / 1000)}`}</small></div>`)
      .join('');
  }
}

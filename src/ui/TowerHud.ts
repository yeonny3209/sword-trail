import { bus } from '../core/bus';

/** 시련의 탑 상태판: 층·남은 시간·남은 몬스터·내 최고 기록 */
export class TowerHud {
  private readonly el: HTMLDivElement;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tower-hud';
    this.el.style.display = 'none';
    ui.appendChild(this.el);
    bus.on('net', (m) => {
      if (m.t === 'tower') {
        const st = m.state === 'fight' ? `남은 몬스터 <b>${m.alive}</b> · <span class="${m.left <= 20 ? 'hurry' : ''}">⏱ ${m.left}초</span>`
          : m.state === 'clear' ? `다음 층까지 ${m.left}초` : m.state === 'over' ? '도전 종료 — 남쪽 포탈로 나가기' : '';
        this.el.innerHTML = `<div class="th-floor">🗼 ${m.floor}층</div><div class="th-st">${st}</div><div class="th-best">최고 기록 ${m.best}층</div>`;
        this.el.style.display = '';
      } else if (m.t === 'welcome') this.el.style.display = 'none';
    });
  }
}

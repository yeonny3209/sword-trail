import { bus } from '../core/bus';

/** 화면 위쪽 가운데에 잠깐 떴다 사라지는 알림(설정 변경·편의 기능 안내 등) */
export class Toast {
  private readonly el: HTMLDivElement;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toasts';
    ui.appendChild(this.el);
    bus.on('toast', ({ text, kind }) => this.show(text, kind ?? 'info'));
  }

  show(text: string, kind: 'info' | 'warn' | 'good'): void {
    // 같은 알림이 연달아 오면 하나만 남긴다
    for (const c of [...this.el.children]) if (c.textContent === text) c.remove();
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.appendChild(t);
    while (this.el.children.length > 4) this.el.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
  }
}

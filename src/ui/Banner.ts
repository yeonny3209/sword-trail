import { bus } from '../core/bus';

/** 화면 가운데 큰 알림(레이드 단계·격노·클리어). 서버가 'banner'를 보내면 잠깐 크게 보여 준다 */
export class Banner {
  private readonly el: HTMLDivElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'banner';
    ui.appendChild(this.el);
    bus.on('net', (m) => {
      if (m.t === 'banner') this.show(m.text, m.kind ?? 'warn');
    });
  }

  show(text: string, kind: 'warn' | 'good'): void {
    this.el.textContent = text;
    this.el.className = `banner ${kind}`;
    void this.el.offsetWidth;
    this.el.classList.add('on');
    bus.emit('sfx', { key: kind === 'good' ? 'gate' : 'warning' });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('on'), 3200);
  }
}

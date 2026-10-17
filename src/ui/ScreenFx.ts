import { bus } from '../core/bus';

/** 화면 전체 연출: 하얀 번쩍임(치명타·보스 처치), 붉은 테두리(내가 맞음) */
export class ScreenFx {
  private readonly flashEl: HTMLDivElement;
  private readonly hurtEl: HTMLDivElement;

  constructor(ui: HTMLElement) {
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'screen-flash';
    this.hurtEl = document.createElement('div');
    this.hurtEl.className = 'screen-hurt';
    ui.prepend(this.flashEl, this.hurtEl);
    bus.on('screen', ({ kind, alpha, ms }) => {
      const el = kind === 'hurt' ? this.hurtEl : this.flashEl;
      el.style.transition = 'none';
      el.style.opacity = String(alpha);
      void el.offsetWidth;
      el.style.transition = `opacity ${ms}ms ease-out`;
      el.style.opacity = '0';
    });
  }
}

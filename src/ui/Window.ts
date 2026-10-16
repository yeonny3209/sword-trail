/** 게임 창(캐릭터·스킬·인벤토리 등) 공통: 제목 막대, 닫기, 끌어서 옮기기, 단축키로 열고 닫기 */
export class Window {
  readonly el: HTMLDivElement;
  readonly body: HTMLDivElement;
  private static z = 10;
  private static openList: Window[] = [];

  constructor(ui: HTMLElement, title: string, readonly key: string, cls = '') {
    this.el = document.createElement('div');
    this.el.className = `win ${cls}`;
    this.el.innerHTML = `<div class="win-head"><span>${title}</span><small>${key}</small><button class="x" title="닫기">✕</button></div><div class="win-body"></div>`;
    this.el.style.display = 'none';
    ui.appendChild(this.el);
    this.body = this.el.querySelector('.win-body')!;
    this.el.querySelector('.x')!.addEventListener('click', () => this.close());
    this.el.addEventListener('mousedown', () => this.front());
    const head = this.el.querySelector<HTMLDivElement>('.win-head')!;
    head.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      const r = this.el.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      const move = (ev: MouseEvent) => {
        this.el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - ox))}px`;
        this.el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - oy))}px`;
        this.el.style.right = 'auto';
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  front(): void {
    this.el.style.zIndex = String(++Window.z);
  }

  open(): void {
    this.el.style.display = '';
    this.front();
    if (!Window.openList.includes(this)) Window.openList.push(this);
    this.draw();
  }

  close(): void {
    this.el.style.display = 'none';
    Window.openList = Window.openList.filter((w) => w !== this);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Esc: 가장 위의 창 닫기 */
  static closeTop(): boolean {
    const w = Window.openList.pop();
    w?.close();
    return !!w;
  }

  draw(): void {}
}

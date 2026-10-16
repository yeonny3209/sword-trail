import { bus } from '../core/bus';
import type { RewardOption } from '../core/events';

/** 보상 선택(각인 3개 중 1개, 휴식 선택). 1/2/3 키 또는 클릭 */
export class RewardMenu {
  private readonly el: HTMLDivElement;
  private options: RewardOption[] = [];
  private queue: { title: string; options: RewardOption[] }[] = [];

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen reward-screen';
    this.el.style.display = 'none';
    ui.appendChild(this.el);
    bus.on('rewardOffer', (offer) => {
      this.queue.push(offer);
      if (this.el.style.display === 'none') this.next();
    });
    window.addEventListener('keydown', (e) => {
      if (this.el.style.display === 'none') return;
      const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (i >= 0 && i < this.options.length) this.choose(this.options[i].id);
    });
  }

  private next(): void {
    const offer = this.queue.shift();
    if (!offer) return;
    this.options = offer.options;
    this.el.innerHTML = `<h2>${offer.title}</h2><div class="cards"></div><p class="sub">1 · 2 · 3 키 또는 클릭</p>`;
    const cards = this.el.querySelector('.cards')!;
    offer.options.forEach((o, i) => {
      const c = document.createElement('div');
      c.className = `card ${o.rarity ?? ''}`;
      c.innerHTML = `<div class="key">${i + 1}</div><div class="n">${o.name}</div>
        ${o.tags?.length ? `<div class="tags">${o.tags.map((t) => `<span>${t}</span>`).join('')}</div>` : ''}
        <div class="d">${o.desc}</div>${o.rarity === 'rare' ? '<div class="r">희귀</div>' : ''}`;
      c.addEventListener('click', () => this.choose(o.id));
      cards.appendChild(c);
    });
    this.el.style.display = '';
    bus.emit('pause', { paused: true, reason: 'menu' });
  }

  private choose(id: string): void {
    this.el.style.display = 'none';
    bus.emit('sfx', { key: 'pickup' });
    bus.emit('rewardChosen', { id });
    if (this.queue.length) return this.next();
    bus.emit('pause', { paused: false, reason: 'menu' });
  }
}

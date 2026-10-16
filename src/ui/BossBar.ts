import { bus } from '../core/bus';
import type { Fighter } from '../combat/Fighter';

/** 화면 아래 보스 체력·자세 게이지 */
export class BossBar {
  private readonly el: HTMLDivElement;
  private readonly hp: HTMLDivElement;
  private readonly lag: HTMLDivElement;
  private readonly posture: HTMLDivElement;
  private boss: Fighter | null = null;
  private lagValue = 1;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'boss-bar';
    this.el.innerHTML = '<div class="name"></div><div class="hp"><div class="lag"></div><div class="fill"></div></div><div class="po"><div></div></div>';
    this.el.style.display = 'none';
    ui.appendChild(this.el);
    this.hp = this.el.querySelector('.hp .fill')!;
    this.lag = this.el.querySelector('.hp .lag')!;
    this.posture = this.el.querySelector('.po div')!;
    bus.on('bossSpawned', ({ fighter }) => {
      this.boss = fighter;
      this.lagValue = 1;
      (this.el.querySelector('.name') as HTMLDivElement).textContent = fighter.name;
      this.el.style.display = '';
    });
    const hide = (f: Fighter) => {
      if (f !== this.boss) return;
      this.boss = null;
      this.el.style.display = 'none';
    };
    bus.on('fighterRemoved', ({ fighter }) => hide(fighter));
    bus.on('clearEnemies', () => this.boss && hide(this.boss));
  }

  render(realDt: number): void {
    const b = this.boss;
    if (!b) return;
    const hp = b.vitals.hp / b.vitals.maxHp;
    this.lagValue = this.lagValue > hp ? Math.max(hp, this.lagValue - realDt * 0.4) : hp;
    this.hp.style.width = `${hp * 100}%`;
    this.lag.style.width = `${this.lagValue * 100}%`;
    this.posture.style.width = `${(b.vitals.posture / b.vitals.maxPosture) * 100}%`;
    this.el.classList.toggle('broken', b.isBroken());
  }
}

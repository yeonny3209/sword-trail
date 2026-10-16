import { bus } from '../core/bus';
import type { Fighter } from '../combat/Fighter';

/** 플레이어 체력·스태미나·자세 바 */
export class Hud {
  readonly root: HTMLDivElement;
  private player: Fighter | null = null;
  private hp: HTMLDivElement;
  private hpLag: HTMLDivElement;
  private stamina: HTMLDivElement;
  private posture: HTMLDivElement;
  private lag = 1;

  constructor(ui: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="bar hp"><div class="lag"></div><div class="fill"></div></div>
      <div class="bar st"><div class="fill"></div></div>
      <div class="posture"><div class="fill"></div></div>`;
    ui.appendChild(this.root);
    this.hp = this.root.querySelector('.hp .fill')!;
    this.hpLag = this.root.querySelector('.hp .lag')!;
    this.stamina = this.root.querySelector('.st .fill')!;
    this.posture = this.root.querySelector('.posture .fill')!;
    bus.on('fighterSpawned', ({ fighter }) => {
      if (fighter.team === 'player') this.player = fighter;
    });
  }

  render(realDt: number): void {
    const p = this.player;
    if (!p) return;
    const v = p.vitals;
    const hp = v.hp / v.maxHp;
    this.lag = this.lag > hp ? Math.max(hp, this.lag - realDt * 0.6) : hp;
    this.hp.style.width = `${hp * 100}%`;
    this.hpLag.style.width = `${this.lag * 100}%`;
    this.stamina.style.width = `${(v.stamina / Math.max(1, v.maxStamina)) * 100}%`;
    // 자세 게이지: 가운데에서 양쪽으로 차오름
    this.posture.style.width = `${(v.posture / v.maxPosture) * 100}%`;
    this.posture.classList.toggle('broken', p.isBroken());
  }
}

import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { Fighter } from '../combat/Fighter';

interface SwordRef { id: string; name: string; skill: string }

/** 플레이어 체력·스태미나·기력·자세 바, 회복약·파편·각인 표시, 상호작용 안내 */
export class Hud {
  readonly root: HTMLDivElement;
  private player: Fighter | null = null;
  private hp: HTMLDivElement;
  private hpLag: HTMLDivElement;
  private stamina: HTMLDivElement;
  private spirit: HTMLDivElement;
  private posture: HTMLDivElement;
  private skill: HTMLDivElement;
  private info: HTMLDivElement;
  private engr: HTMLDivElement;
  private hint: HTMLDivElement;
  private lag = 1;
  private skillCost = 50;
  private potions = '';
  private shards = '';
  private engravings: { name: string; tags: string[] }[] = [];

  constructor(ui: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="info"></div>
      <div class="bar hp"><div class="lag"></div><div class="fill"></div></div>
      <div class="bar st"><div class="fill"></div></div>
      <div class="bar sp"><div class="fill"></div></div>
      <div class="skill">Q</div>
      <div class="posture"><div class="fill"></div></div>
      <div class="engr"></div>
      <div class="hint"></div>`;
    ui.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLDivElement;
    this.hp = q('.hp .fill');
    this.hpLag = q('.hp .lag');
    this.stamina = q('.st .fill');
    this.spirit = q('.sp .fill');
    this.skill = q('.skill');
    this.posture = q('.posture .fill');
    this.info = q('.info');
    this.engr = q('.engr');
    this.hint = q('.hint');
    bus.on('fighterSpawned', ({ fighter }) => {
      if (fighter.team === 'player') this.player = fighter;
    });
    bus.on('potionsChanged', ({ count, max }) => {
      this.potions = `회복약 ${count}/${max}`;
      this.drawInfo();
    });
    bus.on('shardsChanged', ({ run, bank }) => {
      this.shards = `파편 ${run} <small>(보관 ${bank})</small>`;
      this.drawInfo();
    });
    bus.on('equipSword', ({ id }) => {
      const sw = getData<{ list: SwordRef[] }>('swords').list.find((s) => s.id === id);
      if (sw) this.skillCost = getData<{ spirit: number }>(sw.skill).spirit;
    });
    bus.on('engravingGained', (e) => {
      this.engravings.push(e);
      this.drawEngravings();
    });
    const clear = () => {
      this.engravings = [];
      this.drawEngravings();
    };
    bus.on('runStarted', clear);
    bus.on('returnToCamp', clear);
    bus.on('interactHint', ({ text }) => {
      this.hint.textContent = text ?? '';
      this.hint.style.display = text ? '' : 'none';
    });
    this.hint.style.display = 'none';
  }

  private drawInfo(): void {
    this.info.innerHTML = `<span>${this.potions}</span><span>${this.shards}</span>`;
  }

  private drawEngravings(): void {
    const tags: Record<string, number> = {};
    for (const e of this.engravings) for (const t of e.tags) tags[t] = (tags[t] ?? 0) + 1;
    const tagLine = Object.entries(tags).map(([t, n]) => `<span class="${n >= 3 ? 'full' : ''}">${t} ${n}/3</span>`).join('');
    this.engr.innerHTML = this.engravings.length
      ? `<div class="tags">${tagLine}</div>${this.engravings.map((e) => `<div>${e.name}</div>`).join('')}`
      : '';
  }

  render(realDt: number): void {
    const p = this.player;
    if (!p) return;
    const v = p.vitals;
    const hp = v.hp / v.maxHp;
    this.lag = this.lag > hp ? Math.max(hp, this.lag - realDt * 0.6) : hp;
    this.hp.style.width = `${hp * 100}%`;
    this.hpLag.style.width = `${this.lag * 100}%`;
    this.hp.parentElement!.style.width = `${Math.min(100, 70 + v.maxHp * 0.3)}%`;
    this.stamina.style.width = `${(v.stamina / Math.max(1, v.maxStamina)) * 100}%`;
    this.spirit.style.width = `${(v.spirit / Math.max(1, v.maxSpirit)) * 100}%`;
    this.skill.classList.toggle('ready', v.spirit >= this.skillCost);
    // 자세 게이지: 가운데에서 양쪽으로 차오름
    this.posture.style.width = `${(v.posture / v.maxPosture) * 100}%`;
    this.posture.classList.toggle('broken', p.isBroken());
  }
}

import { ACTIONS } from '../../shared/data';
import { skillMp } from '../../shared/rules';
import type { LocalPlayer } from '../game/LocalPlayer';

const KEYS = ['Q', 'E', 'T', 'F', 'G', 'R', '1', '2', '3', '4'];

/** 화면 아래 스킬 단축키 칸: 이름, MP, 쿨타임, 배우는 레벨 */
export class SkillBar {
  private readonly el: HTMLDivElement;
  private slots: { el: HTMLDivElement; cd: HTMLDivElement; mp: HTMLDivElement; id: string | null }[] = [];
  private bound: LocalPlayer | null = null;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'skillbar';
    ui.appendChild(this.el);
  }

  bind(me: LocalPlayer): void {
    this.bound = me;
    this.el.innerHTML = '';
    this.slots = KEYS.map((k, i) => {
      const id = me.kit.skills[i] ?? null;
      const def = id ? ACTIONS[id] : null;
      const el = document.createElement('div');
      el.className = `slot ${def ? '' : 'empty'}`;
      el.innerHTML = `<div class="key">${k}</div><div class="nm">${def?.name ?? ''}</div><div class="mp">${def?.mp ? `MP ${def.mp}` : ''}</div><div class="cd"></div>`;
      if (def) el.title = `${def.name} — ${def.desc ?? ''}\nMP ${def.mp ?? 0} · 쿨타임 ${def.cd ?? 0}초 · Lv ${def.lv ?? 1}`;
      this.el.appendChild(el);
      return { el, cd: el.querySelector('.cd') as HTMLDivElement, mp: el.querySelector('.mp') as HTMLDivElement, id };
    });
  }

  render(): void {
    const me = this.bound;
    if (!me) return;
    const now = performance.now();
    for (const s of this.slots) {
      if (!s.id) continue;
      const def = ACTIONS[s.id];
      const left = Math.max(0, (me.cds.get(s.id) ?? 0) - now);
      const total = (def.cd ?? 0) * 1000;
      const slv = me.skillLevel(s.id);
      const locked = slv < 1;
      s.el.classList.toggle('locked', locked);
      s.el.classList.toggle('nomp', !locked && me.self.mp < skillMp(def, slv));
      s.cd.style.background = left > 0 && total > 0 ? `conic-gradient(rgba(0,0,0,.7) ${(left / total) * 360}deg, transparent 0)` : 'none';
      s.cd.textContent = locked ? ((def.lv ?? 1) > me.self.lv ? `Lv${def.lv}` : '미습득') : left > 0 ? (left / 1000).toFixed(1) : '';
      s.mp.textContent = locked ? '' : `MP ${skillMp(def, slv)}`;
    }
  }
}

/** 쓰러졌을 때: 기다렸다가 부활 */
export class DeathOverlay {
  private readonly el: HTMLDivElement;
  private left = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ui: HTMLElement, private readonly onRevive: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'death';
    this.el.style.display = 'none';
    ui.appendChild(this.el);
  }

  show(wait: number): void {
    this.left = wait;
    this.el.style.display = '';
    this.draw();
    this.timer = setInterval(() => {
      this.left = Math.max(0, this.left - 1);
      this.draw();
    }, 1000);
  }

  private draw(): void {
    this.el.innerHTML = `<div class="box"><h2>쓰러졌습니다</h2>
      <button class="btn primary" ${this.left > 0 ? 'disabled' : ''}>${this.left > 0 ? `${this.left}초 뒤 부활` : '이 지역 입구에서 부활'}</button></div>`;
    this.el.querySelector('button')!.addEventListener('click', () => this.left <= 0 && this.onRevive());
  }

  hide(): void {
    this.el.style.display = 'none';
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

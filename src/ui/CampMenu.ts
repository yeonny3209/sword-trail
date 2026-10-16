import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { SwordDef } from '../player/Player';
import type { UpgradeDef } from '../progression/Progression';
import type { SaveData } from '../progression/Save';

/** 야영지 메뉴: 기술 비석(영구 강화)과 검 거치대(검 해금·교체) */
export class CampMenu {
  private readonly el: HTMLDivElement;
  private save: SaveData | null = null;
  private kind: 'upgrades' | 'swords' | null = null;
  private readonly upgrades = getData<{ list: UpgradeDef[] }>('upgrades').list;
  private readonly swords = getData<{ list: SwordDef[] }>('swords').list;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen camp-menu';
    this.el.style.display = 'none';
    ui.appendChild(this.el);
    bus.on('saveChanged', ({ save }) => {
      this.save = save;
      if (this.kind) this.draw();
    });
    bus.on('openMenu', ({ kind }) => {
      this.kind = kind;
      this.draw();
      this.el.style.display = '';
      bus.emit('pause', { paused: true, reason: 'menu' });
    });
    window.addEventListener('keydown', (e) => {
      if (this.kind && (e.code === 'Escape' || e.code === 'KeyF')) this.close();
    });
  }

  private close(): void {
    this.kind = null;
    this.el.style.display = 'none';
    bus.emit('pause', { paused: false, reason: 'menu' });
  }

  private draw(): void {
    const s = this.save;
    if (!s || !this.kind) return;
    const rows = this.kind === 'upgrades' ? this.upgradeRows(s) : this.swordRows(s);
    this.el.innerHTML = `
      <h2>${this.kind === 'upgrades' ? '기술 비석' : '검 거치대'}</h2>
      <p class="sub">검의 파편 <b class="shards">${s.shards}</b></p>
      <div class="list">${rows}</div>
      <button class="btn close">닫기 (F / Esc)</button>`;
    this.el.querySelector('.close')!.addEventListener('click', () => this.close());
    this.el.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.id!;
        if (this.kind === 'upgrades') bus.emit('buyUpgrade', { id });
        else bus.emit('selectSword', { id });
      }),
    );
  }

  private upgradeRows(s: SaveData): string {
    return this.upgrades.map((u) => {
      const lv = s.upgrades[u.id] ?? 0;
      const maxed = lv >= u.max;
      const cost = maxed ? 0 : u.cost[lv];
      const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      return `<div class="row"><div class="info"><div class="n">${u.name} <span class="pips">${pips}</span></div><div class="d">${u.desc}</div></div>
        ${maxed ? '<span class="done">완료</span>' : `<button class="btn" data-id="${u.id}" ${s.shards < cost ? 'disabled' : ''}>${cost} 파편</button>`}</div>`;
    }).join('');
  }

  private swordRows(s: SaveData): string {
    return this.swords.map((w) => {
      const owned = s.swords.includes(w.id);
      const equipped = s.equipped === w.id;
      const action = equipped ? '<span class="done">장착 중</span>'
        : owned ? `<button class="btn" data-id="${w.id}">장착</button>`
        : `<button class="btn" data-id="${w.id}" ${s.shards < w.cost ? 'disabled' : ''}>${w.cost} 파편으로 뽑기</button>`;
      return `<div class="row"><div class="info"><div class="n">${w.name}</div><div class="d">${w.desc}</div>
        ${owned ? `<div class="memory">“${w.memory}”</div>` : ''}</div>${action}</div>`;
    }).join('');
  }
}

import { bus } from '../core/bus';
import { ACH_LIST, ACHS } from '../../shared/achievements';
import { bountyReward, type BountyState } from '../../shared/bounty';
import { MONSTERS } from '../../shared/data';
import type { C2S } from '../../shared/protocol';
import { Window } from './Window';

type Tab = 'ach' | 'title' | 'bounty';

/** 업적·칭호·현상 수배 창(Y). 현상 수배 게시판 NPC도 이 창을 연다 */
export class AchWindow extends Window {
  prog: Record<string, number> = {};
  title = '';
  bounty: BountyState | null = null;
  lv = 1;
  private tab: Tab = 'ach';

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void) {
    super(ui, '업적 · 칭호 · 현상 수배', 'Y', 'ach-win');
    bus.on('net', (m) => {
      if (m.t === 'achs') {
        this.prog = m.p;
        this.title = m.title;
        this.draw();
      } else if (m.t === 'ach') {
        const a = ACHS[m.id];
        if (!a) return;
        bus.emit('toast', { text: `🏆 업적 달성: ${a.name}${a.title ? ` — 칭호 「${a.title}」 (Y)` : ''}${a.gold ? ` +${a.gold.toLocaleString()} G` : ''}`, kind: 'good' });
        bus.emit('sfx', { key: 'gate' });
      } else if (m.t === 'bounty') {
        this.bounty = m.b;
        this.draw();
      }
    });
  }

  openTab(t: Tab): void {
    this.tab = t;
    this.open();
  }

  draw(): void {
    if (!this.isOpen) return;
    const done = ACH_LIST.filter((a) => (this.prog[a.id] ?? 0) >= a.n).length;
    const tabs = (['ach', 'title', 'bounty'] as Tab[]).map((t) => `<button class="tab ${t === this.tab ? 'on' : ''}" data-tab="${t}">${t === 'ach' ? `업적 ${done}/${ACH_LIST.length}` : t === 'title' ? '칭호' : '현상 수배'}</button>`).join('');
    let body = '';
    if (this.tab === 'ach') {
      body = ACH_LIST.map((a) => {
        const p = Math.min(a.n, this.prog[a.id] ?? 0), ok = p >= a.n;
        return `<div class="ach ${ok ? 'ok' : ''}"><div class="an">${ok ? '🏆' : '·'} <b>${a.name}</b> <small>${a.desc}</small></div>
          <div class="ab"><div style="width:${(p / a.n) * 100}%"></div><span>${p.toLocaleString()} / ${a.n.toLocaleString()}</span></div>
          <div class="ar">${[a.title ? `칭호 「${a.title}」` : '', a.gold ? `${a.gold.toLocaleString()} G` : ''].filter(Boolean).join(' · ')}</div></div>`;
      }).join('');
    } else if (this.tab === 'title') {
      const own = ACH_LIST.filter((a) => a.title && (this.prog[a.id] ?? 0) >= a.n);
      body = `<div class="hint">고른 칭호는 다른 사람에게 이름 위에 보입니다.</div>
        <button class="btn ttl-btn ${!this.title ? 'on' : ''}" data-title="">칭호 없음</button>
        ${own.map((a) => `<button class="btn ttl-btn ${this.title === a.id ? 'on' : ''}" data-title="${a.id}">「${a.title}」</button>`).join('')}
        ${own.length ? '' : '<div class="hint">아직 얻은 칭호가 없습니다. 업적을 달성하면 생깁니다.</div>'}`;
    } else {
      const b = this.bounty;
      body = `<div class="hint">하루(한국 시각 자정 기준) 3건. 목표를 채우는 순간 바로 보상이 들어옵니다. 지금까지 ${b?.total ?? 0}건 완료</div>${(b?.list ?? []).map((x) => {
        const r = bountyReward(x, this.lv), m = MONSTERS[x.m];
        return `<div class="ach ${x.done ? 'ok' : ''}"><div class="an">${x.done ? '✔' : '📜'} <b>${m?.name ?? x.m}</b> <small>Lv${m?.lv ?? '?'}${m?.boss ? ' · 필드 보스' : ''}</small> <button class="btn mini" data-guide="${x.m}">🧭</button></div>
          <div class="ab"><div style="width:${(Math.min(x.got, x.n) / x.n) * 100}%"></div><span>${Math.min(x.got, x.n)} / ${x.n}</span></div>
          <div class="ar">보상 ${r.gold.toLocaleString()} G · 경험치 ${r.exp.toLocaleString()} · 강화석 ${r.stones}</div></div>`;
      }).join('') || '<div class="hint">마을에 들어가면 오늘의 수배가 붙습니다.</div>'}`;
    }
    this.body.innerHTML = `<div class="tabs">${tabs}</div><div class="ach-list">${body}</div>`;
    this.body.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.tab as Tab;
      this.draw();
    }));
    this.body.querySelectorAll<HTMLButtonElement>('[data-title]').forEach((b) => b.addEventListener('click', () => this.send({ t: 'title', id: b.dataset.title ?? '' })));
    this.body.querySelectorAll<HTMLButtonElement>('[data-guide]').forEach((b) => b.addEventListener('click', () => this.onGuide(b.dataset.guide!)));
  }

  /** 수배 몬스터로 길 안내 */
  onGuide: (monsterId: string) => void = () => {};
}

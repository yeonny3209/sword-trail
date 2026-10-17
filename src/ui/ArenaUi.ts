import { bus } from '../core/bus';
import { CLASS_BY_ID, ZONES } from '../../shared/data';
import type { C2S } from '../../shared/protocol';
import { PVP, emptyPvp, type PvpRankRow, type PvpRecord } from '../../shared/pvp';
import { Window } from './Window';

/** 결투장: 화면 위 기록 표시(결투장 안에서만)와 결투장 관리인 카론의 순위표 창 */
export class ArenaUi {
  readonly win: Window;
  private readonly panel: HTMLDivElement;
  private me: PvpRecord = emptyPvp();
  private top: PvpRankRow[] = [];
  private myName = '';

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void, private readonly say: (html: string) => void) {
    this.panel = document.createElement('div');
    this.panel.className = 'arena-panel';
    this.panel.style.display = 'none';
    ui.appendChild(this.panel);
    this.win = new Window(ui, '결투장 순위', '', 'arena-win');
    this.win.draw = () => this.draw();
    bus.on('net', (m) => {
      switch (m.t) {
        case 'welcome':
          this.myName = m.you.name;
          this.me = m.you.pvp ?? emptyPvp();
          this.panel.style.display = ZONES[m.zone]?.pvp ? '' : 'none';
          if (ZONES[m.zone]?.pvp) this.say('⚔ <b>결투장</b>: 파티원이 아닌 모든 사람이 적입니다. 쓰러져도 잃는 것은 없고 3초 뒤 다시 일어납니다.');
          this.drawPanel();
          break;
        case 'pvp':
          this.me = m.me;
          this.drawPanel();
          if (m.delta) bus.emit('sfx', { key: m.delta > 0 ? 'gate' : 'death', volume: 0.6 });
          break;
        case 'pvprank':
          this.me = m.me;
          this.top = m.top;
          this.draw();
          break;
      }
    });
  }

  openRank(): void {
    this.win.open();
    this.send({ t: 'pvprank' });
  }

  private drawPanel(): void {
    const r = this.me;
    this.panel.innerHTML = `<b>⚔ 결투장</b> 처치 <b>${r.k}</b> · 쓰러짐 <b>${r.d}</b> · 점수 <b class="r">${r.r}</b>`;
  }

  private draw(): void {
    if (!this.win.isOpen) return;
    const r = this.me;
    const rows = this.top.map((t, i) => `<tr class="${t.name === this.myName ? 'me' : ''}"><td>${i + 1}</td><td>${t.name}</td>
      <td>Lv${t.lv} ${CLASS_BY_ID[t.cls]?.name ?? ''}</td><td>${t.k} / ${t.d}</td><td class="r">${t.r}</td></tr>`).join('');
    this.win.body.innerHTML = `
      <div class="arena-me">내 기록 — 처치 <b>${r.k}</b> · 쓰러짐 <b>${r.d}</b> · 점수 <b class="r">${r.r}</b></div>
      <table class="arena-top"><thead><tr><th>#</th><th>이름</th><th>직업</th><th>처치/쓰러짐</th><th>점수</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="hint">아직 기록이 없습니다.</td></tr>'}</tbody></table>
      <div class="hint">마을 북쪽 문으로 들어가면 결투장입니다. 파티원이 아닌 모든 사람이 적이며, 플레이어끼리의 피해는 ${Math.round(PVP.damageScale * 100)}%로 줄어듭니다.
      쓰러뜨리면 점수가 오르고(상대 점수가 높을수록 많이), 쓰러지면 내려갑니다. 같은 상대를 ${Math.round(PVP.repeatCooldownSec / 60)}분 안에 다시 쓰러뜨리면 점수는 없습니다.</div>`;
  }
}

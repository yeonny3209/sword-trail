import { CLASS_BY_ID, ZONES } from '../../shared/data';
import type { SelfState } from '../../shared/protocol';
import { expToNext } from '../../shared/rules';

/** 화면 고정 정보: 내 이름·레벨·HP·MP·경험치, 존 이름, 지연시간 */
export class Hud {
  readonly el: HTMLDivElement;
  private me: SelfState | null = null;
  private readonly q: (s: string) => HTMLElement;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="me">
        <div class="portrait"></div>
        <div class="info"><div class="nm"></div>
          <div class="bar hp"><div class="fill"></div><span></span></div>
          <div class="bar mp"><div class="fill"></div><span></span></div>
        </div>
      </div>
      <div class="pts-badge"></div>
      <div class="zone-name"></div>
      <div class="net"></div>
      <div class="expbar"><div class="fill"></div><span></span></div>`;
    ui.appendChild(this.el);
    this.q = (s) => this.el.querySelector(s) as HTMLElement;
  }

  setSelf(me: SelfState): void {
    this.me = me;
    const cls = CLASS_BY_ID[me.cls];
    this.q('.portrait').style.background = cls.color;
    this.q('.portrait').textContent = cls.name[0];
    this.draw();
  }

  setZone(id: string): void {
    const z = ZONES[id];
    this.q('.zone-name').innerHTML = z ? `${z.name}${z.type === 'field' ? ` <small>Lv ${z.level[0]}~${z.level[1]}</small>` : z.type === 'raid' ? ' <small class="pvp">레이드 · 파티 전용</small>' : ''}${z.pvp ? ' <small class="pvp">PvP</small>' : ''}` : '';
  }

  setNet(rtt: number, players: number, online = 0): void {
    this.q('.net').textContent = `${Math.round(rtt)}ms · 이 지역 ${players}명${online ? ` · 접속 ${online}명` : ''}`;
  }

  draw(): void {
    const m = this.me;
    if (!m) return;
    const cls = CLASS_BY_ID[m.cls];
    this.q('.nm').innerHTML = `<b>Lv ${m.lv}</b> ${m.name} <small>${cls.name}</small>`;
    this.q('.hp .fill').style.width = `${(m.hp / m.mhp) * 100}%`;
    this.q('.hp span').textContent = `${Math.round(m.hp)} / ${m.mhp}`;
    this.q('.mp .fill').style.width = `${(m.mp / m.mmp) * 100}%`;
    this.q('.mp span').textContent = `${Math.round(m.mp)} / ${m.mmp}`;
    const need = expToNext(m.lv);
    this.q('.expbar .fill').style.width = `${Math.min(100, (m.exp / need) * 100)}%`;
    this.q('.expbar span').textContent = `EXP ${((m.exp / need) * 100).toFixed(1)}%`;
    const badge = [m.statPoints ? `스탯 +${m.statPoints} (U)` : '', m.skillPoints ? `스킬 +${m.skillPoints} (K)` : ''].filter(Boolean).join(' · ');
    this.q('.pts-badge').textContent = badge;
    this.q('.pts-badge').style.display = badge ? '' : 'none';
  }
}

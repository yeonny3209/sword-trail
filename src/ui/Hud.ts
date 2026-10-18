import { BRANCHES } from '../../shared/branch';
import { CLASS_BY_ID, ZONES } from '../../shared/data';
import type { SelfState } from '../../shared/protocol';
import { expToNext, MAX_LEVEL } from '../../shared/rules';

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
    this.q('.zone-name').innerHTML = z ? `${z.name}${z.type === 'field' ? ` <small>Lv ${z.level[0]}~${z.level[1]}</small>` : z.tower ? ' <small class="pvp">무한 층 도전 · 파티 가능</small>' : z.type === 'raid' ? ' <small class="pvp">레이드 · 파티 전용</small>' : ''}${z.pvp ? ' <small class="pvp">PvP</small>' : ''}` : '';
  }

  setNet(rtt: number, players: number, online = 0): void {
    this.q('.net').textContent = `${Math.round(rtt)}ms · 이 지역 ${players}명${online ? ` · 접속 ${online}명` : ''}`;
  }

  /** 경험치 효율: 최근 5분 동안 얻은 경험치(% 단위)와 시각 */
  private gains: { t: number; pct: number }[] = [];
  private last: { lv: number; exp: number } | null = null;
  private rate = '';
  private started = performance.now();

  /** 얻은 경험치를 %로 기록하고 분당 효율·다음 레벨까지 시간을 계산한다 */
  private trackExp(m: SelfState): void {
    const now = performance.now();
    const l = this.last;
    if (l && (m.lv > l.lv || (m.lv === l.lv && m.exp > l.exp))) {
      const pct = m.lv > l.lv ? (1 - l.exp / expToNext(l.lv)) * 100 + (m.exp / expToNext(m.lv)) * 100 : ((m.exp - l.exp) / expToNext(m.lv)) * 100;
      this.gains.push({ t: now, pct });
    }
    this.last = { lv: m.lv, exp: m.exp };
    this.gains = this.gains.filter((g) => now - g.t < 300_000);
    const total = this.gains.reduce((a, g) => a + g.pct, 0);
    const mins = Math.max(1, (now - Math.max(this.started, this.gains[0]?.t ?? now)) / 60_000);
    const perMin = total / mins;
    if (perMin < 0.05 || m.lv >= MAX_LEVEL) {
      this.rate = '';
      return;
    }
    const left = (100 - (m.exp / expToNext(m.lv)) * 100) / perMin;
    this.rate = ` · 분당 ${perMin.toFixed(1)}% · 다음 레벨까지 약 ${left < 1 ? '1분 미만' : left > 600 ? '10시간+' : `${Math.round(left)}분`}`;
  }

  draw(): void {
    const m = this.me;
    if (!m) return;
    this.trackExp(m);
    const cls = CLASS_BY_ID[m.cls];
    this.q('.nm').innerHTML = `<b>Lv ${m.lv}</b> ${m.name} <small>${m.branch ? (BRANCHES[m.branch]?.name ?? cls.name) : cls.name}</small>`;
    this.q('.hp .fill').style.width = `${(m.hp / m.mhp) * 100}%`;
    this.q('.hp span').textContent = `${Math.round(m.hp)} / ${m.mhp}`;
    this.q('.mp .fill').style.width = `${(m.mp / m.mmp) * 100}%`;
    this.q('.mp span').textContent = `${Math.round(m.mp)} / ${m.mmp}`;
    const need = expToNext(m.lv);
    const max = m.lv >= MAX_LEVEL;
    this.q('.expbar .fill').style.width = max ? '100%' : `${Math.min(100, (m.exp / need) * 100)}%`;
    this.q('.expbar span').textContent = max ? 'MAX LEVEL' : `EXP ${Math.min(100, (m.exp / need) * 100).toFixed(1)}%${this.rate}`;
    const badge = [m.statPoints ? `스탯 +${m.statPoints} (U)` : '', m.skillPoints ? `스킬 +${m.skillPoints} (K)` : ''].filter(Boolean).join(' · ');
    this.q('.pts-badge').textContent = badge;
    this.q('.pts-badge').style.display = badge ? '' : 'none';
  }
}

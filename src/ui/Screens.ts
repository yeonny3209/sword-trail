import { bus } from '../core/bus';
import type { RunSummary } from '../progression/RunStats';
import type { Settings } from '../progression/Save';
import { difficultyNames } from '../core/difficulty';

const CONTROLS = `
  <div class="controls">
    <div><b>WASD</b> 이동</div><div><b>마우스</b> 시점</div>
    <div><b>왼쪽 클릭</b> 약공격 (3타)</div><div><b>Shift+클릭</b> 강공격</div>
    <div><b>오른쪽 유지</b> 막기 · 누르는 순간 패링</div><div><b>스페이스</b> 구르기</div>
    <div><b>휠 클릭 / Tab</b> 적 고정</div><div><b>Q · R</b> 검 기술 · <b>E</b> 회복약</div>
    <div><b>F</b> 상호작용</div><div><b>F1</b> 디버그 · <b>H</b> 조작법</div>
  </div>
  <div class="rules">흰 빛 = 패링 가능 · <span style="color:#ff5a4a">붉은 빛 = 회피만</span></div>`;

/**
 * 타이틀, 일시정지, 방 안내, 페이드, 결과 화면.
 * 화면이 열려 있는 동안은 'pause' 이벤트로 게임을 멈춘다.
 */
export class Screens {
  private readonly title: HTMLDivElement;
  private readonly pauseEl: HTMLDivElement;
  private readonly result: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly fade: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private bannerTimer = 0;
  private toastTimer = 0;
  private started = false;
  /** 현재 일시정지 이유(메뉴 등이 열려 있으면 일시정지 화면을 띄우지 않는다) */
  private readonly reasons = new Set<string>(['title']);
  private settings: Settings = { volume: 1, mouseSensitivity: 1, screenShake: true, difficulty: 'easy' };

  constructor(ui: HTMLElement) {
    const el = (cls: string, html = '') => {
      const d = document.createElement('div');
      d.className = cls;
      d.innerHTML = html;
      ui.appendChild(d);
      return d;
    };
    this.banner = el('banner');
    this.toast = el('toast');
    this.fade = el('fade');
    this.help = el('help-panel', CONTROLS);
    this.help.style.display = 'none';
    this.title = el('screen title-screen', `
      <h1>검의 궤적</h1>
      <p class="sub">부러진 검들이 묻힌 산 — 첫 번째 검을 향해</p>
      ${CONTROLS}
      <button class="btn">클릭하여 시작</button>`);
    this.pauseEl = el('screen pause-screen', `<h2>일시정지</h2>${CONTROLS}
      <div class="settings">
        <label>마우스 감도 <input type="range" class="sens" min="0.3" max="2.5" step="0.05"></label>
        <label>음량 <input type="range" class="vol" min="0" max="1" step="0.05"></label>
        <label><input type="checkbox" class="shake"> 화면 흔들림</label>
        <label>난이도 <select class="diff">${Object.entries(difficultyNames).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      </div>
      <button class="btn resume">클릭하여 계속</button>`);
    this.pauseEl.style.display = 'none';
    const sens = this.pauseEl.querySelector('.sens') as HTMLInputElement;
    const vol = this.pauseEl.querySelector('.vol') as HTMLInputElement;
    const shake = this.pauseEl.querySelector('.shake') as HTMLInputElement;
    const diff = this.pauseEl.querySelector('.diff') as HTMLSelectElement;
    const emit = () => bus.emit('settingsChanged', {
      settings: { mouseSensitivity: Number(sens.value), volume: Number(vol.value), screenShake: shake.checked, difficulty: diff.value },
    });
    diff.addEventListener('change', emit);
    sens.addEventListener('input', emit);
    vol.addEventListener('input', emit);
    shake.addEventListener('change', emit);
    bus.on('settingsChanged', ({ settings }) => {
      this.settings = settings;
      sens.value = String(settings.mouseSensitivity);
      vol.value = String(settings.volume);
      shake.checked = settings.screenShake;
      diff.value = settings.difficulty;
    });
    bus.on('pause', ({ paused, reason }) => (paused ? this.reasons.add(reason) : this.reasons.delete(reason)));
    this.result = el('screen result-screen');
    this.result.style.display = 'none';

    this.title.addEventListener('click', () => {
      this.title.style.display = 'none';
      this.started = true;
      bus.emit('sfx', { key: 'ui' });
      bus.emit('pause', { paused: false, reason: 'title' });
    });
    this.pauseEl.querySelector('.resume')!.addEventListener('click', () => this.resume());

    bus.on('roomEntered', (e) => {
      if (e.type === 'camp') this.showBanner(e.name, '출구로 나가면 등반 시작 · 허수아비로 연습하세요');
      else this.showBanner(`${e.zone} — ${e.name}`, `${e.index} / ${e.total}${e.type === 'boss' ? ' · 보스' : e.type === 'elite' ? ' · 정예' : e.type === 'rest' ? ' · 휴식' : ''}`);
    });
    bus.on('waveStarted', (e) => e.total > 1 && this.showToast(`웨이브 ${e.index} / ${e.total}`));
    bus.on('gateOpened', () => this.showToast('출구가 열렸다'));
    bus.on('bossPhase', (e) => this.showBanner(`${e.fighter.name}가 검을 고쳐 잡는다`, '연속 공격과 붉은 빛 회전베기에 주의'));
    bus.on('transition', ({ seconds }) => {
      this.fade.style.transition = `opacity ${seconds / 2}s`;
      this.fade.style.opacity = '1';
      setTimeout(() => (this.fade.style.opacity = '0'), (seconds / 2) * 1000 + 30);
    });
    bus.on('runSummary', ({ summary }) => this.showResult(summary));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
      if ((e.code === 'KeyR' || e.code === 'Enter') && this.result.style.display !== 'none') this.closeResult();
    });
  }

  get isStarted(): boolean {
    return this.started;
  }

  get resultOpen(): boolean {
    return this.result.style.display !== 'none';
  }

  get currentSettings(): Settings {
    return this.settings;
  }

  /** 포인터 잠금이 풀렸을 때 */
  showPause(): void {
    if (!this.started || this.reasons.size > 0) return;
    this.pauseEl.style.display = '';
    bus.emit('pause', { paused: true, reason: 'unlock' });
  }

  private resume(): void {
    this.pauseEl.style.display = 'none';
    bus.emit('pause', { paused: false, reason: 'unlock' });
  }

  showBanner(title: string, sub: string): void {
    this.banner.innerHTML = `<div class="t">${title}</div><div class="s">${sub}</div>`;
    this.banner.style.opacity = '1';
    this.bannerTimer = 3.2;
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    this.toastTimer = 1.8;
  }

  private showResult(s: RunSummary): void {
    const mm = Math.floor(s.seconds / 60), ss = String(s.seconds % 60).padStart(2, '0');
    const rate = s.parryAttempts ? Math.round((s.parries / s.parryAttempts) * 100) : 0;
    this.result.innerHTML = `
      <h2 class="${s.victory ? 'win' : 'lose'}">${s.victory ? '문을 넘었다' : '쓰러졌다'}</h2>
      <p class="sub">${s.victory ? '문지기를 쓰러뜨렸다. 산은 더 높이 이어진다.' : `${s.roomName}에서 — ${s.deathCause || '알 수 없음'}`}</p>
      <table>
        <tr><td>런 시간</td><td>${mm}:${ss}</td></tr>
        <tr><td>처치</td><td>${s.kills}</td></tr>
        <tr><td>돌파한 방</td><td>${s.roomsCleared}</td></tr>
        <tr><td>패링</td><td>${s.parries} / 시도 ${s.parryAttempts} (${rate}%)</td></tr>
        <tr><td>막기 · 회피</td><td>${s.blocks} · ${s.dodges}</td></tr>
        <tr><td>받은 피해</td><td>${s.damageTaken}</td></tr>
        <tr><td>검의 파편</td><td>${s.shardsEarned} 획득 → ${s.shardsKept} 보존</td></tr>
        ${s.engravings.length ? `<tr><td>각인</td><td>${s.engravings.join(', ')}</td></tr>` : ''}
      </table>
      <button class="btn">야영지로 (R)</button>`;
    this.result.style.display = '';
    this.result.querySelector('button')!.addEventListener('click', () => this.closeResult());
    bus.emit('pause', { paused: true, reason: 'result' });
  }

  private closeResult(): void {
    this.result.style.display = 'none';
    bus.emit('sfx', { key: 'ui' });
    bus.emit('pause', { paused: false, reason: 'result' });
    bus.emit('returnToCamp', {});
  }

  render(realDt: number): void {
    if (this.bannerTimer > 0 && (this.bannerTimer -= realDt) <= 0) this.banner.style.opacity = '0';
    if (this.toastTimer > 0 && (this.toastTimer -= realDt) <= 0) this.toast.style.opacity = '0';
  }
}

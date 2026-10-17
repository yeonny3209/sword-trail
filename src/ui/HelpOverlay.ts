import { bus } from '../core/bus';

const KEYS: [string, string][] = [
  ['WASD / 방향키', '이동 (같은 방향 두 번 = 달리기)'], ['마우스 왼쪽 · X · J', '공격 (누르고 있으면 계속), 커서 방향으로'],
  ['Space', '점프 · NPC 대화 · 채집 · 쓰러진 파티원 살리기'], ['Z', '백스텝(무적)'],
  ['Q E T F G R 1 2 3 4', '스킬'], ['C / V', 'HP / MP 물약 (설정에서 자동 물약)'],
  ['B', '마을 귀환 (5초, 맞으면 끊김)'], ['Tab', '큰 지도 — 누른 곳으로 자동 이동'],
  ['I · U · K · L', '인벤토리 · 캐릭터 · 스킬 · 퀘스트'], ['P · N', '파티 · 길드'],
  ['Y', '업적 · 칭호 · 현상 수배'], ['H', '피해량 측정기'],
  ['오른쪽 드래그', '카메라 돌리기·기울이기 (Home: 처음으로)'], ['마우스 휠', '확대 · 축소'],
  ['오른쪽 클릭(플레이어)', '귓속말 · 파티 · 거래'], ['Enter', '채팅 (/전체 /파티 /길드 /w 이름 /r 답장, ↑↓ 지난 입력)'],
  ['F10 · Esc', '설정 (창이 열려 있으면 Esc는 창 닫기)'], ['F4 · M', '빛 번짐 · 배경음악 끄고 켜기'],
];

/** 조작법 한눈에 보기(F1) */
export class HelpOverlay {
  private readonly el: HTMLDivElement;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'help-overlay';
    this.el.style.display = 'none';
    this.el.innerHTML = `<div class="box"><h2>조작법</h2><div class="keys">${KEYS.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div>
      <div class="tip">팁: 퀘스트 추적기의 🧭를 누르면 목표까지 자동으로 걸어갑니다. 아무 이동 키나 누르면 멈춥니다.</div>
      <button class="btn primary">닫기 (F1)</button></div>`;
    ui.appendChild(this.el);
    this.el.querySelector('button')!.addEventListener('click', () => this.toggle(false));
    this.el.addEventListener('mousedown', (e) => e.target === this.el && this.toggle(false));
    bus.on('help', () => this.toggle());
  }

  toggle(on = this.el.style.display === 'none'): void {
    this.el.style.display = on ? '' : 'none';
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }
}

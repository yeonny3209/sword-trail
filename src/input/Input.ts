import { bus } from '../core/bus';
import { getData } from '../core/config';

export type Action =
  | 'up' | 'down' | 'left' | 'right' | 'attack' | 'jump' | 'back' | 'dash'
  | 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 'pot1' | 'pot2'
  | 's7' | 's8' | 's9' | 's10'
  | 'inventory' | 'skills' | 'character' | 'quests' | 'party' | 'guild' | 'camreset' | 'debug';

interface InputData {
  bindings: Record<string, string[]>;
  doubleTapMs: number;
}

/**
 * 키·마우스 → 행동 이름. 같은 방향을 빠르게 두 번 누르면 'dash'.
 * 채팅 입력 중이거나 창이 열려 있으면 게임 입력을 막는다.
 */
export class Input {
  readonly data = getData<InputData>('input');
  pressed = new Set<Action>();
  /** 이번 단계에서 대시가 시작된 방향(화면 기준) */
  dashDir: { x: number; y: number } | null = null;
  private queued: Action[] = [];
  private queuedDash: { x: number; y: number } | null = null;
  private codes = new Set<string>();
  private codeToActions = new Map<string, Action[]>();
  private lastTap: Record<string, number> = {};
  /** 화면 좌표(px) */
  mouseX = 0;
  mouseY = 0;
  wheel = 0;
  enabled = true;
  /** 카메라가 돌아간 각도(라디안). 이동 입력을 이만큼 돌려서 항상 '지금 화면 기준'으로 움직이게 한다 */
  viewYaw = 0;
  /** 오른쪽 버튼을 누른 채 끌지 않고 짧게 눌렀다 뗐을 때(플레이어 메뉴용), 화면 좌표 */
  onRightTap: ((x: number, y: number) => void) | null = null;
  private rightDown = false;
  private rightMoved = 0;
  private dragDx = 0;
  private dragDy = 0;

  constructor(private readonly canvas: HTMLElement) {
    for (const [action, codes] of Object.entries(this.data.bindings)) {
      for (const c of codes) this.codeToActions.set(c, [...(this.codeToActions.get(c) ?? []), action as Action]);
    }
    const typingTarget = (e: Event) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    window.addEventListener('keydown', (e) => {
      if (typingTarget(e) || e.ctrlKey || e.metaKey) return;
      if (this.codeToActions.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.press(e.code);
    });
    window.addEventListener('keyup', (e) => this.codes.delete(e.code));
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.press(`Mouse${e.button}`);
      if (e.button === 2) {
        this.rightDown = true;
        this.rightMoved = 0;
      }
    });
    window.addEventListener('mouseup', (e) => {
      this.codes.delete(`Mouse${e.button}`);
      if (e.button !== 2 || !this.rightDown) return;
      this.rightDown = false;
      canvas.style.cursor = '';
      if (this.rightMoved < 5) this.onRightTap?.(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (!this.rightDown) return;
      this.rightMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
      // 짧게 흔들린 것은 클릭으로 보고, 5px 넘게 끌었을 때부터 회전
      if (this.rightMoved >= 5) {
        this.dragDx += e.movementX;
        this.dragDy += e.movementY;
        canvas.style.cursor = 'grabbing';
      }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => {
      this.codes.clear();
      this.rightDown = false;
    });
    bus.on('typing', ({ active }) => {
      this.enabled = !active;
      if (active) this.codes.clear();
    });
  }

  private press(code: string): void {
    const actions = this.codeToActions.get(code);
    if (!actions) return;
    this.codes.add(code);
    if (!this.enabled) return;
    const now = performance.now();
    for (const a of actions) {
      this.queued.push(a);
      if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
        if (now - (this.lastTap[a] ?? -1e9) < this.data.doubleTapMs) {
          this.queued.push('dash');
          this.queuedDash = { x: a === 'left' ? -1 : a === 'right' ? 1 : 0, y: a === 'up' ? 1 : a === 'down' ? -1 : 0 };
        }
        this.lastTap[a] = now;
      }
    }
  }

  /** 고정 단계 시작: 쌓인 입력을 이번 단계의 눌림으로 */
  beginTick(): void {
    this.pressed = new Set(this.queued);
    this.dashDir = this.queuedDash;
    this.queued = [];
    this.queuedDash = null;
  }

  /** 쌓인 입력 취소(NPC를 눌렀을 때 공격 무시 등) */
  cancel(a: Action): void {
    this.queued = this.queued.filter((q) => q !== a);
    this.pressed.delete(a);
  }

  isDown(a: Action): boolean {
    if (!this.enabled) return false;
    for (const c of this.data.bindings[a] ?? []) if (this.codes.has(c)) return true;
    return false;
  }

  /** 이동 입력(카메라가 돌아간 만큼 돌린 값). x: 세계 +X(동), y: 세계 북쪽(-Z) + (길이 1로 정규화) */
  moveAxis(): { x: number; y: number } {
    const x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    const y = (this.isDown('up') ? 1 : 0) - (this.isDown('down') ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    const c = Math.cos(this.viewYaw), s = Math.sin(this.viewYaw);
    return { x: (x * c - y * s) / len, y: (x * s + y * c) / len };
  }

  /** 오른쪽 드래그로 움직인 거리(px)를 한 번 꺼낸다: 가로는 카메라 돌리기, 세로는 내려다보는 각도 */
  consumeDrag(): { dx: number; dy: number } {
    const d = { dx: this.dragDx, dy: this.dragDy };
    this.dragDx = this.dragDy = 0;
    return d;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** 캔버스 기준 정규화 좌표(-1~1) */
  mouseNdc(): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((this.mouseX - r.left) / r.width) * 2 - 1, y: -((this.mouseY - r.top) / r.height) * 2 + 1 };
  }
}

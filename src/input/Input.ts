import { bus } from '../core/bus';
import { getData } from '../core/config';

export type Action =
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight'
  | 'attack' | 'heavy' | 'block' | 'dodge' | 'lockOn'
  | 'heal' | 'skill' | 'interact' | 'debug';

interface InputData {
  bindings: Record<string, string[]>;
  attackTapMs: number;
  heavyChargeMs: number;
  mouseSensitivity: number;
}

/**
 * 키·마우스 입력을 행동 이름으로 바꾸는 계층.
 * 왼쪽 버튼은 짧게 떼면 "attack", 길게 누르면 차지 후 "heavy"로 변환한다.
 */
export class Input {
  readonly data = getData<InputData>('input');
  /** 이번 고정 단계에서 눌린 행동 */
  pressed = new Set<Action>();
  private queued: Action[] = [];
  private codesDown = new Set<string>();
  private codeToAction = new Map<string, Action>();
  private attackHoldStart: number | null = null;
  private heavyFired = false;
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  /** 메뉴가 열려 있을 때는 게임 입력을 막는다 */
  enabled = true;
  /** 설정의 마우스 감도 배율 */
  sensitivity = 1;

  constructor(private readonly canvas: HTMLElement) {
    bus.on('settingsChanged', ({ settings }) => (this.sensitivity = settings.mouseSensitivity));
    for (const [action, codes] of Object.entries(this.data.bindings)) {
      for (const code of codes) this.codeToAction.set(code, action as Action);
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.releaseAll();
    });
  }

  requestLock(): void {
    if (this.locked) return;
    // 사용자 동작 밖이거나 Esc 직후면 거부된다 → 다음 클릭 때 다시 잠근다
    const r = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
    r?.catch?.(() => {});
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** 고정 단계 시작 시 호출: 쌓인 입력을 이번 단계의 눌림으로 옮긴다. */
  beginTick(): void {
    this.pressed = new Set(this.queued);
    this.queued = [];
    if (this.attackHoldStart !== null && !this.heavyFired) {
      if (performance.now() - this.attackHoldStart >= this.data.heavyChargeMs) {
        this.heavyFired = true;
        this.pressed.add('heavy');
      }
    }
  }

  isDown(action: Action): boolean {
    if (!this.enabled) return false;
    for (const code of this.data.bindings[action] ?? []) if (this.codesDown.has(code)) return true;
    return false;
  }

  /** 강공격 차지 중인가(짧게 누르기 기준을 넘김) */
  charging(): boolean {
    return (
      this.enabled && this.attackHoldStart !== null && !this.heavyFired &&
      performance.now() - this.attackHoldStart >= this.data.attackTapMs
    );
  }

  /** 이동 입력. x: 오른쪽 +, y: 앞 + */
  moveAxis(): { x: number; y: number } {
    const x = (this.isDown('moveRight') ? 1 : 0) - (this.isDown('moveLeft') ? 1 : 0);
    const y = (this.isDown('moveForward') ? 1 : 0) - (this.isDown('moveBack') ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  consumeMouse(): { dx: number; dy: number } {
    const k = this.data.mouseSensitivity * this.sensitivity;
    const r = { dx: this.mouseDX * k, dy: this.mouseDY * k };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  private press(code: string): void {
    const action = this.codeToAction.get(code);
    if (!action || !this.enabled) return;
    if (action === 'attack') {
      this.attackHoldStart = performance.now();
      this.heavyFired = false;
      return;
    }
    this.queued.push(action);
  }

  private release(code: string): void {
    const action = this.codeToAction.get(code);
    if (action === 'attack' && this.attackHoldStart !== null) {
      if (!this.heavyFired && this.enabled) this.queued.push('attack');
      this.attackHoldStart = null;
    }
  }

  private releaseAll(): void {
    this.codesDown.clear();
    this.attackHoldStart = null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.codeToAction.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.codesDown.add(e.code);
    // 디버그 토글은 포인터 잠금 없이도 동작
    if (this.codeToAction.get(e.code) === 'debug') {
      this.queued.push('debug');
      return;
    }
    this.press(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.codesDown.delete(e.code);
    this.release(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
    if (!this.locked) return; // 첫 클릭은 포인터 잠금용
    const code = `Mouse${e.button}`;
    this.codesDown.add(code);
    this.press(code);
  };

  private onMouseUp = (e: MouseEvent): void => {
    const code = `Mouse${e.button}`;
    this.codesDown.delete(code);
    this.release(code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked || !this.enabled) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
}

import { bus } from '../core/bus';
import { getData } from '../core/config';

export type Action =
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight'
  | 'attack' | 'heavy' | 'block' | 'dodge' | 'lockOn'
  | 'heal' | 'skill' | 'interact' | 'debug' | 'heavyModifier';

interface InputData {
  bindings: Record<string, string[]>;
  mouseSensitivity: number;
}

/**
 * 키·마우스 입력을 행동 이름으로 바꾸는 계층.
 * 왼쪽 버튼은 누르는 순간 "attack", Shift를 누른 채면 "heavy"로 바꾼다.
 */
export class Input {
  readonly data = getData<InputData>('input');
  /** 이번 고정 단계에서 눌린 행동 */
  pressed = new Set<Action>();
  private queued: Action[] = [];
  private codesDown = new Set<string>();
  private codeToAction = new Map<string, Action>();
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
  }

  isDown(action: Action): boolean {
    if (!this.enabled) return false;
    for (const code of this.data.bindings[action] ?? []) if (this.codesDown.has(code)) return true;
    return false;
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
    if (!action || !this.enabled || action === 'heavyModifier') return;
    // 누르는 순간 바로 공격(입력 지연 0). Shift를 누르고 있으면 강공격
    if (action === 'attack' && this.isDown('heavyModifier')) {
      this.queued.push('heavy');
      return;
    }
    this.queued.push(action);
  }

  private releaseAll(): void {
    this.codesDown.clear();
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
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
    if (!this.locked) return; // 첫 클릭은 포인터 잠금용
    const code = `Mouse${e.button}`;
    this.codesDown.add(code);
    this.press(code);
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.codesDown.delete(`Mouse${e.button}`);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked || !this.enabled) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
}

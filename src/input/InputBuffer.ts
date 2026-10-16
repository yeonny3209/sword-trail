import type { Action } from './Input';

/**
 * 입력 버퍼: 공격 중에 누른 다음 입력을 일정 시간(프레임) 기억했다가
 * 캔슬 가능 구간에 꺼내 쓴다. 이것이 없으면 콤보가 "씹힌다".
 */
export class InputBuffer {
  private entries: { action: Action; frame: number }[] = [];

  constructor(private readonly windowFrames: number) {}

  push(action: Action, frame: number): void {
    this.entries.push({ action, frame });
    if (this.entries.length > 8) this.entries.shift();
  }

  /** 허용 목록 중 가장 최근의 유효 입력을 꺼낸다. */
  consume(allowed: readonly Action[], frame: number): Action | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (frame - e.frame > this.windowFrames) break;
      if (allowed.includes(e.action)) {
        this.entries.splice(i, 1);
        return e.action;
      }
    }
    return null;
  }

  peek(allowed: readonly Action[], frame: number): Action | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (frame - e.frame > this.windowFrames) break;
      if (allowed.includes(e.action)) return e.action;
    }
    return null;
  }

  clear(): void {
    this.entries = [];
  }
}

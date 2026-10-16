/**
 * 고정 시간 단계 루프. 게임 논리는 1/60초 단위로만 진행하고,
 * 렌더링은 화면 주사율대로 하면서 남은 시간 비율(alpha)로 보간한다.
 */
export class GameLoop {
  readonly step: number;
  frame = 0;
  private acc = 0;
  private last = 0;
  private running = false;

  constructor(
    hz: number,
    private readonly update: (dt: number, frame: number) => void,
    private readonly render: (alpha: number, realDt: number) => void,
  ) {
    this.step = 1 / hz;
  }

  start(): void {
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const realDt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.acc += realDt;
    while (this.acc >= this.step) {
      this.update(this.step, this.frame);
      this.frame++;
      this.acc -= this.step;
    }
    this.render(this.acc / this.step, realDt);
    requestAnimationFrame(this.tick);
  };
}

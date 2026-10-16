/** 화면 구석 FPS 표시. 0.5초마다 평균을 갱신한다. */
export class FpsCounter {
  private el: HTMLDivElement;
  private frames = 0;
  private time = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'fps';
    parent.appendChild(this.el);
  }

  update(realDt: number): void {
    this.frames++;
    this.time += realDt;
    if (this.time >= 0.5) {
      this.el.textContent = `FPS ${Math.round(this.frames / this.time)}`;
      this.frames = 0;
      this.time = 0;
    }
  }
}

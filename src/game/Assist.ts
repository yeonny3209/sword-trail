import { bus } from '../core/bus';
import { settings } from '../core/Settings';
import type { C2S, S2C } from '../../shared/protocol';
import type { Input } from '../input/Input';
import type { LocalPlayer } from './LocalPlayer';
import type { Monsters } from './Monsters';

/** 조준 보조: 마우스 방향에서 이만큼(라디안) 안쪽, 이 거리 안의 적에게 맞춘다 */
const AIM_CONE = 0.55;
const AIM_RANGE = 7.5;

/**
 * 전투 도우미: 자동 물약, 조준 보조, 마을 귀환(B, 5초 시전 막대).
 * 실제 판정·회복·이동은 모두 서버가 다시 확인한다.
 */
export class Assist {
  private potT = 0;
  private recallEnd = 0;
  private readonly bar: HTMLDivElement;

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void, private readonly potions: (k: 1 | 2) => number) {
    this.bar = document.createElement('div');
    this.bar.className = 'castbar';
    this.bar.style.display = 'none';
    this.bar.innerHTML = '<div class="cb-name">마을 귀환</div><div class="cb-bar"><div class="cb-fill"></div></div>';
    ui.appendChild(this.bar);
    bus.on('net', (m) => this.onNet(m));
  }

  private onNet(m: S2C): void {
    if (m.t === 'recall') {
      this.recallEnd = m.ms ? performance.now() + m.ms : 0;
      this.bar.style.display = m.ms ? '' : 'none';
      if (!m.ms) bus.emit('toast', { text: '마을 귀환이 끊겼습니다.', kind: 'warn' });
    } else if (m.t === 'goto') {
      this.recallEnd = 0;
      this.bar.style.display = 'none';
    }
  }

  /** 고정 단계마다 */
  update(dt: number, input: Input, me: LocalPlayer, autoMoving: boolean): void {
    // 마을 귀환: B로 시작, 움직이거나 공격하면 취소
    if (input.pressed.has('recall')) {
      if (this.recallEnd) this.cancelRecall();
      else this.send({ t: 'recall', on: true });
    } else if (this.recallEnd && (input.manualMove() || autoMoving || me.pstate === 'action' || me.pstate === 'dead')) this.cancelRecall();
    if (this.recallEnd) {
      const left = Math.max(0, this.recallEnd - performance.now());
      (this.bar.querySelector('.cb-fill') as HTMLDivElement).style.width = `${(1 - left / 5000) * 100}%`;
    }
    // 자동 물약
    this.potT -= dt;
    const s = settings.v, self = me.self;
    if (this.potT <= 0 && me.pstate !== 'dead') {
      if (s.autoHp > 0 && self.hp > 0 && self.hp / self.mhp < s.autoHp && this.potions(1) > 0) this.drink(1);
      else if (s.autoMp > 0 && self.mp / self.mmp < s.autoMp && this.potions(2) > 0) this.drink(2);
    }
  }

  private drink(k: 1 | 2): void {
    this.send({ t: 'pot', k });
    this.potT = 1.3;
  }

  private cancelRecall(): void {
    this.send({ t: 'recall', on: false });
    this.recallEnd = 0;
    this.bar.style.display = 'none';
  }

  /** 마우스 방향(aim) 근처에 적이 있으면 그쪽으로 살짝 돌린 방향 */
  aim(me: LocalPlayer, aim: number, monsters: Monsters): number {
    if (!settings.v.aimAssist) return aim;
    let best = aim, score = Infinity;
    for (const v of monsters.list.values()) {
      if (v.dying || v.hp <= 0) continue;
      const dx = v.pos.x - me.pos.x, dz = v.pos.z - me.pos.z;
      const d = Math.hypot(dx, dz) - v.def.radius;
      if (d > AIM_RANGE) continue;
      const yaw = Math.atan2(dx, dz);
      const diff = Math.abs(Math.atan2(Math.sin(yaw - aim), Math.cos(yaw - aim)));
      if (diff > AIM_CONE) continue;
      const sc = diff * 4 + d * 0.15;
      if (sc < score) {
        score = sc;
        best = yaw;
      }
    }
    return best;
  }
}

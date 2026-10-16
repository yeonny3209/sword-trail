import { bus } from '../core/bus';
import { getData } from '../core/config';

interface HitstopData { parry: number; finisher: number; postureBreak: number; blocked: number; useAttackHitstop: boolean }

/** 맞는 순간 게임 논리를 몇 프레임 멈춘다. 전투 이벤트만 구독한다. */
export class Hitstop {
  constructor() {
    const d = getData<{ hitstop: HitstopData }>('fx').hitstop;
    const stop = (frames: number) => frames > 0 && bus.emit('hitstop', { frames });
    bus.on('hit', (e) => stop(e.finisher ? d.finisher : d.useAttackHitstop ? e.attack.hitstop : 3));
    bus.on('parrySuccess', () => stop(d.parry));
    bus.on('blocked', () => stop(d.blocked));
    bus.on('postureBreak', () => stop(d.postureBreak));
  }
}

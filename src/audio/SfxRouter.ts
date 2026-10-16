import { bus } from '../core/bus';

/** 전투 이벤트를 사운드 키로 바꾼다. 전투 코드는 소리를 모른다. */
export class SfxRouter {
  constructor() {
    const play = (key: string | undefined, volume?: number) => key && bus.emit('sfx', { key, volume });
    bus.on('attackActive', (e) => play(e.attack.sfx, e.fighter.team === 'player' ? 1 : 0.8));
    bus.on('hit', (e) => {
      if (e.finisher) play('finisher');
      else play(e.attack.hitSfx ?? 'slash');
      if (e.target.team === 'player') play('hurt');
    });
    bus.on('blocked', () => play('block'));
    bus.on('parrySuccess', () => play('parry'));
    bus.on('dodgeStarted', () => play('dodge', 0.8));
    bus.on('postureBreak', () => play('postureBreak'));
    bus.on('death', () => play('death'));
    // 예고 소리: 붉은 빛(회피만 가능)은 경고음, 흰 빛은 짧은 쇳소리
    bus.on('telegraph', (e) => play(e.attack.glow === 'red' ? 'warning' : 'telegraph'));
  }
}

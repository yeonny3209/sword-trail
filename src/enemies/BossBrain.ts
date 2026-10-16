import { bus } from '../core/bus';
import type { Fighter } from '../combat/Fighter';
import type { Enemy } from './Enemy';
import { MeleeBrain } from './MeleeBrain';
import type { EnemyData } from './types';

interface BossData extends EnemyData {
  phase2At: number;
  phaseShiftFrames: number;
  phase2Speed: number;
  phase2Color: string;
}

/**
 * 보스: 일반 적 상태 기계에 페이즈를 더한다.
 * 체력이 phase2At 아래로 떨어지면 잠시 포효(강인함) 후 2페이즈 패턴이 열린다.
 * 멀리 떨어지면 붉은 빛 돌진으로 거리를 좁힌다.
 */
export class BossBrain extends MeleeBrain {
  update(e: Enemy, t: Fighter, dt: number): void {
    const d = e.data as BossData;
    const f = e.fighter;
    if (e.phase === 1 && f.alive && f.vitals.hp / f.vitals.maxHp <= d.phase2At && e.state !== 'broken') {
      e.phase = 2;
      e.interrupt();
      e.setState('phaseShift');
      f.mods.attackSpeed = d.phase2Speed;
      e.view.setColor(d.phase2Color);
      bus.emit('bossPhase', { fighter: f, phase: 2 });
      return;
    }
    if (e.state === 'phaseShift') {
      e.move(0, 0, dt);
      e.face(e.yawTo(t), d.turnSpeed, dt);
      if (f.stateFrame >= d.phaseShiftFrames) {
        e.resetCooldown(0.3);
        e.setState('circle');
      }
      return;
    }
    // 멀리 있으면 돌진 공격을 고려한다
    if (e.state === 'approach' && t.alive) {
      e.cooldown -= dt;
      if (e.cooldown <= 0) {
        const atk = this.choose(e, e.distTo(t));
        if (atk && atk.minRange) {
          e.choice = atk;
          e.engageTime = 0;
          e.setState('engage');
          return;
        }
      }
    }
    super.update(e, t, dt);
  }
}

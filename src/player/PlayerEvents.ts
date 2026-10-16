import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { Player } from './Player';

interface SpiritData { max: number; onHit: number; onParry: number; onFinisher: number }

/** 플레이어가 구독하는 이벤트: 피격 반응, 순간이동, 회복, 기력, 회복약, 검 교체 */
export function listenPlayerEvents(p: Player): void {
  const me = p.fighter;
  const spirit = getData<{ spirit: SpiritData }>('progression').spirit;
  me.vitals.maxSpirit = spirit.max;
  const gainSpirit = (n: number) => (me.vitals.spirit = Math.min(me.vitals.maxSpirit, me.vitals.spirit + n));

  bus.on('hit', (e) => {
    if (e.attacker === me) gainSpirit(e.finisher ? spirit.onFinisher : spirit.onHit);
    if (e.target !== me || !me.alive) return;
    p.knockFrom(e.attacker.pos, (e.attack.knockback ?? 1) * p.data.knockback);
    if (me.superArmor || me.isBroken()) return;
    p.interrupt();
    p.stunFrames = p.data.hitstunFrames;
    p.setState('hitstun');
  });
  bus.on('parrySuccess', (e) => e.defender === me && gainSpirit(spirit.onParry));
  bus.on('blocked', (e) => {
    if (e.defender !== me || e.guardBreak) return;
    p.knockFrom(e.attacker.pos, 0.5 * p.data.knockback);
  });
  bus.on('postureBreak', (e) => {
    if (e.fighter !== me) return;
    p.interrupt();
    p.setState('broken');
  });
  bus.on('death', (e) => {
    if (e.fighter !== me) return;
    p.interrupt();
    p.setState('dead');
  });
  bus.on('lockChanged', ({ target }) => (p.lockTarget = target));
  bus.on('teleportPlayer', ({ x, z, yaw }) => {
    p.body.teleport(x, z);
    me.pos.set(x, 0, z);
    me.yaw = yaw;
    p.push.set(0, 0);
    p.vel.set(0, 0);
    me.snap();
  });
  bus.on('resetPlayer', () => p.reset());
  bus.on('heal', ({ target, amount }) => {
    if (target !== me || !me.alive) return;
    me.vitals.hp = Math.min(me.vitals.maxHp, me.vitals.hp + amount);
  });
  bus.on('potionsChanged', ({ count }) => (p.potions = count));
  bus.on('equipSword', ({ id }) => p.equip(id));
}

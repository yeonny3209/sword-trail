import { resolveCircle } from '../../shared/geom';
import type { C2S, S2C } from '../../shared/protocol';
import type { Monster } from './Monster';
import type { ZoneDef } from '../../shared/types';
import type { PlayerSession } from './PlayerSession';

export const PLAYER_RADIUS = 0.4;

/** 클라이언트가 보낸 위치를 검사해서 받아들인다: 속도(버프 반영)와 벽을 넘으면 잘라내고 알려 준다 */
export function applyMove(zone: ZoneDef, p: PlayerSession, m: Extract<C2S, { t: 'move' }>): void {
  if (p.leaving || p.dead) return;
  const now = Date.now();
  const dt = Math.min(1, Math.max(0.05, (now - p.lastMoveAt) / 1000));
  p.lastMoveAt = now;
  let x = Number(m.x), z = Number(m.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  // 속도 검사: 대시·밀림을 감안해 넉넉하게, 넘으면 이동 방향으로 잘라낸다
  const base = p.eff.speed * 2.4 * dt + 0.8;
  const maxStep = base + p.moveBudget;
  const dx = x - p.x, dz = z - p.z;
  const d = Math.hypot(dx, dz);
  p.moveBudget = Math.max(0, p.moveBudget - Math.max(0, d - base));
  let corrected = false;
  if (d > maxStep) {
    x = p.x + (dx / d) * maxStep;
    z = p.z + (dz / d) * maxStep;
    corrected = true;
  }
  const [rx, rz] = resolveCircle(x, z, PLAYER_RADIUS, zone.walls, zone.size);
  if (Math.hypot(rx - x, rz - z) > 0.4) corrected = true;
  p.x = rx;
  p.z = rz;
  p.y = Math.max(0, Math.min(8, Number(m.y) || 0));
  p.f = Number(m.f) || 0;
  p.st = m.st | 0;
  p.dirty = true;
  if (corrected) p.send({ t: 'pos', x: p.x, z: p.z });
}

/** 20Hz: 몬스터 진행(쓰러진 몬스터는 다시 나오게, 소환·이벤트 몬스터는 지움) + 서로 겹치지 않게 밀어내기 */
export function stepMonsters(monsters: Map<number, Monster>, dt: number, z: ZoneDef, players: Iterable<PlayerSession>, emit: (m: S2C) => void): void {
  const list = [...players];
  for (const m of monsters.values()) {
    if (m.dead) {
      m.respawnT -= dt;
      if (m.respawnT <= 0) {
        if (m.summoned || m.temporary) {
          monsters.delete(m.id);
          continue;
        }
        m.respawn(z);
        emit({ t: 'mspawn', m: m.info() });
      }
      continue;
    }
    // 한 마리에서 오류가 나도 존 전체가 멈추지 않게
    try {
      m.update(dt, z, list, emit);
    } catch (e) {
      console.error('monster update', m.def.id, e);
    }
  }
  // 띄워진 몬스터는 밀지 않는다
  const alive = [...monsters.values()].filter((m) => !m.dead && !m.body.air);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i].body, b = alive[j].body;
      const min = alive[i].def.radius + alive[j].def.radius;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), push = (min - d) / 2;
      a.x -= (dx / d) * push;
      a.z -= (dz / d) * push;
      b.x += (dx / d) * push;
      b.z += (dz / d) * push;
    }
  }
}

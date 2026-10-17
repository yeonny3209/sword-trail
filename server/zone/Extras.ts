import { ZONES } from '../../shared/data';
import type { C2S } from '../../shared/protocol';
import type { ZoneDef } from '../../shared/types';
import type { Achievements } from './Achieve';
import type { PlayerSession } from './PlayerSession';

/** 마을 귀환 시전 시간 */
export const RECALL_MS = 5000;

export interface ExtraHost {
  zone: ZoneDef;
  ach: Achievements;
  /** 다른 존으로 보낸다(저장 → goto → 연결 끊기) */
  travel(p: PlayerSession, key: string, x: number, z: number): Promise<void>;
}

export type ExtraMsg = Extract<C2S, { t: 'recall' | 'title' }>;
export const EXTRA_MSGS = new Set<string>(['recall', 'title']);

/** 편의 기능 메시지: 마을 귀환·칭호 */
export function onExtra(h: ExtraHost, p: PlayerSession, m: ExtraMsg): void {
  if (m.t === 'title') return h.ach.setTitle(p, String(m.id ?? ''));
  if (!m.on) {
    if (p.recallAt) p.send({ t: 'recall', ms: 0 });
    p.recallAt = 0;
    return;
  }
  if (h.zone.type === 'town') return p.send({ t: 'err', text: '이미 마을입니다.' });
  if (p.dead) return;
  if (Date.now() - p.lastHurtAt < 2000) return p.send({ t: 'err', text: '공격받는 중에는 귀환할 수 없습니다.' });
  p.recallAt = Date.now();
  p.send({ t: 'recall', ms: RECALL_MS });
}

/** 20Hz: 시전이 끝난 사람을 마을로 */
export function recallTick(h: ExtraHost, players: Iterable<PlayerSession>, now: number): void {
  for (const p of players) {
    if (!p.recallAt || p.leaving || now - p.recallAt < RECALL_MS) continue;
    p.recallAt = 0;
    if (p.dead) continue;
    const town = ZONES.town;
    void h.travel(p, town.id, town.spawn[0], town.spawn[1]);
  }
}

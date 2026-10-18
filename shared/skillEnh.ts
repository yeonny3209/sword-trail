import type { HitShape } from './geom';
import type { ActionDef } from './types';

/** 스킬 강화: 스킬 하나에 셋 중 하나를 골라 붙인다(골드, 스킬 레벨 3부터) */
export type EnhKind = 'pow' | 'haste' | 'wide';

export const ENH_LIST: { id: EnhKind; name: string; desc: string; icon: string }[] = [
  { id: 'pow', name: '위력', desc: '피해 +25%', icon: '⚔' },
  { id: 'haste', name: '쾌속', desc: '재사용 시간 -25%, MP -10%', icon: '⚡' },
  { id: 'wide', name: '광역', desc: '공격 범위 +25%', icon: '◎' },
];
export const ENH_NAME: Record<EnhKind, string> = { pow: '위력', haste: '쾌속', wide: '광역' };
export const ENH_MIN_SLV = 3;

export function isEnh(k: unknown): k is EnhKind {
  return k === 'pow' || k === 'haste' || k === 'wide';
}

/** 강화 비용(골드): 배우는 레벨이 높을수록 비쌈 */
export function enhPrice(def: ActionDef): number {
  return Math.round(1500 + (def.lv ?? 1) * 350);
}

export function powMul(k?: EnhKind | ''): number {
  return k === 'pow' ? 1.25 : 1;
}

/** 재사용 시간 배율: 장비·전직의 재사용 시간 감소(cdr)와 쾌속 강화 */
export function cdMul(k: EnhKind | '' | undefined, cdr = 0): number {
  return (1 - Math.min(0.5, cdr)) * (k === 'haste' ? 0.75 : 1);
}

export function mpMul(k?: EnhKind | ''): number {
  return k === 'haste' ? 0.9 : 1;
}

function widen(s: HitShape): HitShape {
  const out = { ...s, range: Math.round(s.range * 1.25 * 100) / 100 };
  if (s.type === 'box') out.width = Math.round(s.width * 1.25 * 100) / 100;
  else if (s.type === 'arc') out.width = Math.min(340, Math.round(s.width * 1.2));
  return out;
}

const cache = new Map<string, ActionDef>();

/**
 * 강화가 반영된 행동. '광역'이면 판정 도형(와 효과 범위)이 커진 복사본, 그 밖에는 원래 행동.
 * 서버(피해 판정)와 클라이언트(내 판정·연출)가 같은 결과를 쓴다.
 */
export function enhancedAction(def: ActionDef, k?: EnhKind | ''): ActionDef {
  if (k !== 'wide') return def;
  let a = cache.get(def.id);
  if (!a) {
    a = { ...def, hits: def.hits.map((h) => ({ ...h, shape: widen(h.shape) })) };
    if (def.cast?.foe) a.cast = { ...def.cast, foe: { ...def.cast.foe, shape: widen(def.cast.foe.shape) } };
    cache.set(def.id, a);
  }
  return a;
}

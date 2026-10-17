/** 공용 게임 데이터. JSON을 정적으로 불러와 서버·클라이언트가 똑같이 쓴다. */
import classesJson from '../data/classes.json';
import monstersJson from '../data/monsters.json';
import town from '../data/zones/town.json';
import field1 from '../data/zones/field1.json';
import arena from '../data/zones/arena.json';
import field2 from '../data/zones/field2.json';
import field3 from '../data/zones/field3.json';
import field4 from '../data/zones/field4.json';
import raid1 from '../data/zones/raid1.json';
import swordsman from '../data/kits/swordsman.json';
import berserker from '../data/kits/berserker.json';
import blademaster from '../data/kits/blademaster.json';
import spellblade from '../data/kits/spellblade.json';
import type { ActionDef, ClassDef, ClassId, ClassKit, MonsterDef, ZoneDef } from './types';

export const CLASSES = classesJson.list as ClassDef[];
export const CLASS_BY_ID = Object.fromEntries(CLASSES.map((c) => [c.id, c])) as Record<ClassId, ClassDef>;

export const ZONES: Record<string, ZoneDef> = Object.fromEntries(
  ([town, field1, field2, field3, field4, arena, raid1] as unknown as ZoneDef[]).map((z) => [z.id, z]),
);

export const START_ZONE = 'town';

/** 존 서버 이름(레이드는 `raid1~12`처럼 방 번호가 붙음)에서 존 종류만 */
export function baseZone(key: string): string {
  return key.split('~')[0];
}

/** 직업별 기술 세트 */
export const KITS = { swordsman, berserker, blademaster, spellblade } as unknown as Record<ClassId, ClassKit>;

// 자세 키프레임은 프레임 순서로 정렬해 둔다
for (const k of Object.values(KITS)) for (const a of k.actions) a.pose.sort((x, y) => x[0] - y[0]);

/** 모든 행동(id → 정의) */
export const ACTIONS: Record<string, ActionDef> = Object.fromEntries(
  Object.values(KITS).flatMap((k) => k.actions.map((a) => [a.id, a])),
);

/** 스킬(단축키로 쓰는 기술)인가 */
export function isSkill(cls: ClassId, id: string): boolean {
  return KITS[cls].skills.includes(id);
}

/** 행동이 그 직업의 것인가 */
export function actionOf(cls: ClassId, id: string): ActionDef | null {
  const a = ACTIONS[id];
  return a && KITS[cls].actions.includes(a) ? a : null;
}

export const MONSTERS: Record<string, MonsterDef> = Object.fromEntries(
  (monstersJson.list as unknown as MonsterDef[]).map((m) => [m.id, m]),
);

export function isClassId(v: unknown): v is ClassId {
  return typeof v === 'string' && v in CLASS_BY_ID;
}

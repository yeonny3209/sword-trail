/** 공용 게임 데이터. JSON을 정적으로 불러와 서버·클라이언트가 똑같이 쓴다. */
import classesJson from '../data/classes.json';
import town from '../data/zones/town.json';
import field1 from '../data/zones/field1.json';
import arena from '../data/zones/arena.json';
import type { ClassDef, ClassId, ZoneDef } from './types';

export const CLASSES = classesJson.list as ClassDef[];
export const CLASS_BY_ID = Object.fromEntries(CLASSES.map((c) => [c.id, c])) as Record<ClassId, ClassDef>;

export const ZONES: Record<string, ZoneDef> = Object.fromEntries(
  ([town, field1, arena] as unknown as ZoneDef[]).map((z) => [z.id, z]),
);

export const START_ZONE = 'town';

export function isClassId(v: unknown): v is ClassId {
  return typeof v === 'string' && v in CLASS_BY_ID;
}

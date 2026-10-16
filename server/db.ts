import { CLASS_BY_ID, START_ZONE, ZONES } from '../shared/data';
import type { CharacterSummary } from '../shared/protocol';
import { baseStats } from '../shared/rules';
import type { ClassId } from '../shared/types';
import type { Env } from './env';

/** 캐릭터의 진행 정보(JSON 한 칸에 저장). 필드를 추가하면 migrateData에 기본값을 넣는다 */
export interface CharData {
  v: number;
  exp: number;
  gold: number;
  hp: number;
  mp: number;
}

export interface CharRow {
  id: number;
  account_id: number;
  name: string;
  class: ClassId;
  level: number;
  zone: string;
  x: number;
  z: number;
  data: string;
}

export const MAX_CHARACTERS = 4;

export function migrateData(raw: unknown, cls: ClassId, lv: number): CharData {
  const s = baseStats(cls, lv);
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<CharData>;
  return {
    v: 1,
    exp: d.exp ?? 0,
    gold: d.gold ?? 100,
    hp: d.hp ?? s.mhp,
    mp: d.mp ?? s.mmp,
  };
}

export async function listCharacters(env: Env, accountId: number): Promise<CharacterSummary[]> {
  const { results } = await env.DB.prepare('SELECT id, name, class, level, zone FROM characters WHERE account_id = ? ORDER BY id')
    .bind(accountId).all<{ id: number; name: string; class: ClassId; level: number; zone: string }>();
  return results.map((r) => ({ id: r.id, name: r.name, cls: r.class, lv: r.level, zone: r.zone }));
}

export async function createCharacter(env: Env, accountId: number, name: string, cls: ClassId): Promise<{ id: number } | { error: string }> {
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM characters WHERE account_id = ?').bind(accountId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_CHARACTERS) return { error: `캐릭터는 ${MAX_CHARACTERS}개까지 만들 수 있습니다.` };
  const taken = await env.DB.prepare('SELECT id FROM characters WHERE name = ?').bind(name).first();
  if (taken) return { error: '이미 있는 캐릭터 이름입니다.' };
  if (!CLASS_BY_ID[cls]) return { error: '알 수 없는 직업입니다.' };
  const z = ZONES[START_ZONE];
  const now = Date.now();
  const res = await env.DB.prepare(
    'INSERT INTO characters (account_id, name, class, level, zone, x, z, data, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)',
  ).bind(accountId, name, cls, START_ZONE, z.spawn[0], z.spawn[1], JSON.stringify(migrateData(null, cls, 1)), now, now).run();
  return { id: Number(res.meta.last_row_id) };
}

export async function deleteCharacter(env: Env, accountId: number, id: number): Promise<boolean> {
  const res = await env.DB.prepare('DELETE FROM characters WHERE id = ? AND account_id = ?').bind(id, accountId).run();
  return res.meta.changes > 0;
}

export async function loadCharacter(env: Env, id: number): Promise<CharRow | null> {
  return env.DB.prepare('SELECT id, account_id, name, class, level, zone, x, z, data FROM characters WHERE id = ?')
    .bind(id).first<CharRow>();
}

export async function saveCharacter(env: Env, c: { id: number; level: number; zone: string; x: number; z: number; data: CharData }): Promise<void> {
  await env.DB.prepare('UPDATE characters SET level = ?, zone = ?, x = ?, z = ?, data = ?, updated_at = ? WHERE id = ?')
    .bind(c.level, c.zone, Math.round(c.x * 100) / 100, Math.round(c.z * 100) / 100, JSON.stringify(c.data), Date.now(), c.id).run();
}

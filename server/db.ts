import { CLASS_BY_ID, KITS, START_ZONE, ZONES } from '../shared/data';
import type { CharacterSummary } from '../shared/protocol';
import { baseStats, emptyAlloc, SKILL_POINTS_PER_LEVEL, STAT_POINTS_PER_LEVEL, type Alloc } from '../shared/rules';
import type { ClassId } from '../shared/types';
import { makeItem, type Equip, type Item } from '../shared/items';
import { emptyQuests, type QuestState } from '../shared/quests';
import type { Env } from './env';

/** 캐릭터의 진행 정보(JSON 한 칸에 저장). 필드를 추가하면 migrateData에 기본값을 넣는다 */
export interface CharData {
  v: number;
  exp: number;
  gold: number;
  hp: number;
  mp: number;
  alloc: Alloc;
  statPoints: number;
  skillPoints: number;
  skills: Record<string, number>;
  inv: Item[];
  equip: Equip;
  quests: QuestState;
  /** 채집 숙련도 */
  gather: { lv: number; exp: number };
}

export function newUid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
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
  // v1 → v2: 스탯·스킬 포인트 도입. 이미 오른 레벨만큼 포인트를 돌려준다
  const fresh = !d.alloc;
  return {
    v: 4,
    exp: d.exp ?? 0,
    gold: d.gold ?? 100,
    hp: d.hp ?? s.mhp,
    mp: d.mp ?? s.mmp,
    alloc: { ...emptyAlloc(), ...(d.alloc ?? {}) },
    statPoints: fresh ? STAT_POINTS_PER_LEVEL * (lv - 1) : d.statPoints ?? 0,
    skillPoints: fresh ? SKILL_POINTS_PER_LEVEL * (lv - 1) : d.skillPoints ?? 0,
    skills: { [KITS[cls].skills[0]]: 1, ...(d.skills ?? {}) },
    // v2 → v3: 아이템. 처음이면 기본 무기와 물약을 준다
    inv: d.inv ?? [makeItem('pot_hp_s', 5, newUid()), makeItem('pot_mp_s', 3, newUid())],
    equip: d.equip ?? { weapon: makeItem(`w_${cls}_0`, 1, newUid(), 0, () => 0) },
    // v3 → v4: 퀘스트·채집
    quests: d.quests ?? emptyQuests(),
    gather: d.gather ?? { lv: 1, exp: 0 },
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

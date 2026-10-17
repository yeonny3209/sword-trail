import { MONSTERS, ZONES } from './data';
import { expToNext } from './rules';

/** 현상 수배 한 건: 몬스터 m을 n마리(지금 got) */
export interface Bounty {
  m: string;
  n: number;
  got: number;
  done: boolean;
}

export interface BountyState {
  /** 한국 시각 날짜(YYYY-MM-DD). 날짜가 바뀌면 새 목록 */
  day: string;
  list: Bounty[];
  /** 지금까지 완료한 수(업적용) */
  total: number;
}

export const BOUNTY_COUNT = 3;

export function emptyBounty(): BountyState {
  return { day: '', list: [], total: 0 };
}

/** 한국 시각 기준 날짜 */
export function bountyDay(now = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 날짜·캐릭터마다 정해지는 난수 */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** 사냥터에 실제로 나오는 몬스터(보스 포함) */
function fieldMonsters(): { id: string; lv: number; boss: boolean }[] {
  const ids = new Set<string>();
  for (const z of Object.values(ZONES)) if (z.type === 'field') for (const s of z.spawns) ids.add(s.monster);
  return [...ids].map((id) => ({ id, lv: MONSTERS[id].lv, boss: !!MONSTERS[id].boss }));
}

/** 오늘의 현상 수배 3건: 내 레벨 근처 몬스터 2건 + (Lv11부터) 레벨 맞는 필드 보스 또는 일반 1건 */
export function makeBounties(charId: number, lv: number, day: string): Bounty[] {
  const rnd = seeded(`${day}:${charId}`);
  const all = fieldMonsters();
  const normals = all.filter((m) => !m.boss);
  let near = normals.filter((m) => m.lv >= lv - 6 && m.lv <= lv + 2);
  if (near.length < BOUNTY_COUNT) near = [...normals].sort((a, b) => Math.abs(a.lv - lv) - Math.abs(b.lv - lv)).slice(0, BOUNTY_COUNT + 1);
  const out: Bounty[] = [];
  const pool = [...near];
  while (out.length < 2 && pool.length) {
    const m = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    out.push({ m: m.id, n: 10 + Math.floor(rnd() * 3) * 5, got: 0, done: false });
  }
  const boss = all.filter((m) => m.boss && m.lv <= lv + 3 && m.lv >= lv - 10).sort((a, b) => b.lv - a.lv)[0];
  if (boss && lv >= 11) out.push({ m: boss.id, n: 1, got: 0, done: false });
  else if (pool.length) out.push({ m: pool[Math.floor(rnd() * pool.length)].id, n: 20, got: 0, done: false });
  return out;
}

/** 한 건 보상: 골드·경험치(내 레벨 필요 경험치의 비율)·강화석 */
export function bountyReward(b: Bounty, lv: number): { gold: number; exp: number; stones: number } {
  const mon = MONSTERS[b.m];
  const boss = !!mon?.boss;
  return {
    gold: Math.round((mon?.lv ?? 1) * (boss ? 220 : 9 * b.n)),
    exp: Math.round(expToNext(lv) * (boss ? 0.18 : 0.1 + b.n * 0.004)),
    stones: boss ? 3 : 1,
  };
}

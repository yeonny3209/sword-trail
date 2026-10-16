import questsJson from '../data/quests.json';
import recipesJson from '../data/recipes.json';

export interface QuestObjective {
  type: 'kill' | 'collect' | 'visit';
  /** 몬스터 id / 아이템 id / 존 id */
  target: string;
  n: number;
}

export interface QuestDef {
  id: string;
  name: string;
  /** 퀘스트를 주는 NPC id */
  giver: string;
  lv: number;
  req?: string;
  desc: string;
  obj: QuestObjective[];
  reward: { exp?: number; gold?: number; items?: [string, number][]; equip?: { lv: number; rar: number } };
}

/** 캐릭터의 퀘스트 진행: 진행 중(목표별 진행 수) + 끝낸 목록 */
export interface QuestState {
  active: Record<string, number[]>;
  done: string[];
}

export interface RecipeDef {
  id: string;
  out: string;
  n: number;
  need: [string, number][];
  gold: number;
  lv: number;
  /** 장비 제작 시 최소 등급 */
  minRar?: number;
}

export const QUESTS: Record<string, QuestDef> = Object.fromEntries((questsJson.list as unknown as QuestDef[]).map((q) => [q.id, q]));
export const QUEST_LIST = questsJson.list as unknown as QuestDef[];
export const RECIPES: Record<string, RecipeDef> = Object.fromEntries((recipesJson.list as unknown as RecipeDef[]).map((r) => [r.id, r]));
export const RECIPE_LIST = recipesJson.list as unknown as RecipeDef[];

export const MAX_ACTIVE_QUESTS = 8;

export function emptyQuests(): QuestState {
  return { active: {}, done: [] };
}

/** 이 NPC에게서 지금 받을 수 있는 퀘스트 */
export function availableQuests(qs: QuestState, giver: string, lv: number): QuestDef[] {
  return QUEST_LIST.filter((q) => q.giver === giver && !qs.done.includes(q.id) && !(q.id in qs.active)
    && (!q.req || qs.done.includes(q.req)) && q.lv <= lv);
}

/**
 * 목표 진행 수. collect는 가방 개수로 센다(count 함수).
 */
export function progressOf(q: QuestDef, qs: QuestState, count: (id: string) => number): number[] {
  const p = qs.active[q.id] ?? [];
  return q.obj.map((o, i) => (o.type === 'collect' ? Math.min(o.n, count(o.target)) : Math.min(o.n, p[i] ?? 0)));
}

export function isComplete(q: QuestDef, qs: QuestState, count: (id: string) => number): boolean {
  const p = progressOf(q, qs, count);
  return q.obj.every((o, i) => p[i] >= o.n);
}

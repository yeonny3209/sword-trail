import branchJson from '../data/branches.json';
import type { Perk } from './perks';
import type { ClassId } from './types';

/** 전직 갈래: 레벨 30에 직업마다 둘 중 하나를 고른다. 능력치·효과와 전용 스킬 둘이 생긴다 */
export interface BranchDef {
  cls: ClassId;
  id: string;
  name: string;
  desc: string;
  perks: Perk;
  /** 전직 스킬 둘(스킬바 5, 6번 칸) */
  skills: [string, string];
}

export const BRANCH_RULES = branchJson as unknown as { unlockLv: number; cost: number; changeCost: number; grantPoints: number; list: BranchDef[] };
export const BRANCHES: Record<string, BranchDef> = Object.fromEntries(BRANCH_RULES.list.map((b) => [b.id, b]));

export function branchesOf(cls: ClassId): BranchDef[] {
  return BRANCH_RULES.list.filter((b) => b.cls === cls);
}

export function branchPerk(id?: string): Perk | undefined {
  return id ? BRANCHES[id]?.perks : undefined;
}

/** 이 직업의 모든 전직 스킬(어느 갈래든) */
export function allBranchSkills(cls: ClassId): string[] {
  return branchesOf(cls).flatMap((b) => b.skills);
}

/** 스킬바에 올라가는 스킬 12칸: 기본 10 + 전직 스킬 둘(없으면 null) */
export function skillSlots(baseSkills: string[], branch?: string): (string | null)[] {
  const b = branch ? BRANCHES[branch] : undefined;
  return [...baseSkills, b?.skills[0] ?? null, b?.skills[1] ?? null];
}

/** 이 스킬을 지금 쓸 수 있는 갈래인가(기본 스킬이면 항상 true) */
export function branchAllows(cls: ClassId, skillId: string, branch?: string): boolean {
  if (!allBranchSkills(cls).includes(skillId)) return true;
  return !!branch && !!BRANCHES[branch]?.skills.includes(skillId as never);
}

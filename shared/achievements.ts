import achJson from '../data/achievements.json';

/** 업적 종류: 처치(대상 몬스터 또는 '*' 전부)·보스·정예·레벨·탑 층·강화 단계·퀘스트·현상 수배·채집·제작·결투 */
export type AchType = 'kill' | 'boss' | 'elite' | 'level' | 'tower' | 'enhance' | 'quest' | 'bounty' | 'gather' | 'craft' | 'pvp';

export interface AchDef {
  id: string;
  name: string;
  desc: string;
  type: AchType;
  target?: string;
  n: number;
  /** 달성하면 얻는 칭호(이름 위에 표시) */
  title?: string;
  gold?: number;
}

export const ACH_LIST = (achJson as { list: AchDef[] }).list;
export const ACHS: Record<string, AchDef> = Object.fromEntries(ACH_LIST.map((a) => [a.id, a]));

/** 값이 '도달한 최고치'인 종류(레벨·탑·강화)는 더하지 않고 큰 값을 남긴다 */
export const ACH_ABSOLUTE: AchType[] = ['level', 'tower', 'enhance'];

/** 진행도 하나를 반영한다. 새로 달성한 업적 id들을 돌려준다 */
export function advance(prog: Record<string, number>, type: AchType, target: string | undefined, amount: number): string[] {
  const done: string[] = [];
  for (const a of ACH_LIST) {
    if (a.type !== type || (a.target && a.target !== '*' && a.target !== target)) continue;
    const before = prog[a.id] ?? 0;
    if (before >= a.n) continue;
    const now = ACH_ABSOLUTE.includes(type) ? Math.max(before, amount) : before + amount;
    prog[a.id] = Math.min(a.n, now);
    if (now >= a.n) done.push(a.id);
  }
  return done;
}

/** 이 칭호를 쓸 수 있나(업적을 달성했나) */
export function titleUnlocked(prog: Record<string, number>, achId: string): boolean {
  const a = ACHS[achId];
  return !!a?.title && (prog[a.id] ?? 0) >= a.n;
}

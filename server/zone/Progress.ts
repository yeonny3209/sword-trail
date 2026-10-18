import { ACTIONS, KITS } from '../../shared/data';
import { BRANCH_RULES, BRANCHES } from '../../shared/branch';
import type { C2S } from '../../shared/protocol';
import { emptyAlloc, SKILL_POINTS_PER_LEVEL, skillMax, STAT_KEYS, STAT_POINTS_PER_LEVEL } from '../../shared/rules';
import type { PlayerSession } from './PlayerSession';

/** 캐릭터 성장: 스탯 포인트 분배 */
export function onStat(p: PlayerSession, m: Extract<C2S, { t: 'stat' }>): void {
  if (!STAT_KEYS.includes(m.s) || p.data.statPoints < 1) return;
  p.data.statPoints--;
  p.data.alloc[m.s]++;
  p.recalc();
  p.dirty = true;
  p.send({ t: 'me', s: p.self() });
}

/** 스킬 배우기·레벨 올리기 */
export function onSkill(p: PlayerSession, m: Extract<C2S, { t: 'skill' }>): void {
  const id = String(m.a);
  const def = ACTIONS[id];
  const mine = KITS[p.cls].skills.includes(id) || !!BRANCHES[p.data.branch]?.skills.includes(id as never);
  if (!def || !mine) return;
  const cur = p.data.skills[id] ?? 0;
  if (p.data.skillPoints < 1) return p.send({ t: 'err', text: '스킬 포인트가 없습니다.' });
  if ((def.lv ?? 1) > p.lv) return p.send({ t: 'err', text: `레벨 ${def.lv}부터 배울 수 있습니다.` });
  if (cur >= skillMax(def)) return p.send({ t: 'err', text: '이미 최고 레벨입니다.' });
  p.data.skillPoints--;
  p.data.skills[id] = cur + 1;
  p.dirty = true;
  p.send({ t: 'me', s: p.self() });
}

/** 포인트를 모두 돌려받는다(첫 스킬은 1레벨 유지) */
export function onReset(p: PlayerSession): void {
  p.data.alloc = emptyAlloc();
  p.data.statPoints = STAT_POINTS_PER_LEVEL * (p.lv - 1);
  p.data.skills = { [KITS[p.cls].skills[0]]: 1 };
  p.data.skillPoints = SKILL_POINTS_PER_LEVEL * (p.lv - 1) + (p.data.branchGrant ? BRANCH_RULES.grantPoints : 0);
  p.data.senh = {};
  p.recalc();
  p.dirty = true;
  p.send({ t: 'me', s: p.self() });
  p.send({ t: 'sys', text: '스탯과 스킬을 초기화했습니다.' });
}

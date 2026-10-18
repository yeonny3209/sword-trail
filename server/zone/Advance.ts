import { BRANCH_RULES, BRANCHES, branchAllows } from '../../shared/branch';
import { ACTIONS, isSkill } from '../../shared/data';
import { ITEMS, socketCount } from '../../shared/items';
import type { C2S } from '../../shared/protocol';
import { ENH_MIN_SLV, enhPrice, isEnh } from '../../shared/skillEnh';
import type { ZoneDef } from '../../shared/types';
import { nearNpc, syncInv, takeItem } from './Inventory';
import type { PlayerSession } from './PlayerSession';

export type AdvanceMsg = Extract<C2S, { t: 'socket' | 'unsocket' | 'branch' | 'senh' }>;
export const ADVANCE_MSGS = new Set<string>(['socket', 'unsocket', 'branch', 'senh']);

const SOCKET_BASE = 150;
const UNSOCKET_GOLD = 400;

/** 전직·스킬 강화·룬 소켓 */
export function onAdvance(p: PlayerSession, zone: ZoneDef, m: AdvanceMsg): void {
  switch (m.t) {
    case 'socket': return socket(p, zone, String(m.uid), m.i | 0, String(m.rune));
    case 'unsocket': return unsocket(p, zone, String(m.uid), m.i | 0);
    case 'branch': return chooseBranch(p, zone, String(m.id));
    case 'senh': return enhance(p, String(m.a), String(m.k));
  }
}

function findGear(p: PlayerSession, uid: string) {
  return p.data.inv.find((x) => x.uid === uid) ?? Object.values(p.data.equip).find((x) => x?.uid === uid);
}

/** 룬을 소켓에 끼운다(이미 끼운 룬이 있으면 부서지고 새로 끼운다) */
function socket(p: PlayerSession, zone: ZoneDef, uid: string, i: number, runeUid: string): void {
  if (!nearNpc(p, zone, 'smith')) return p.send({ t: 'err', text: '대장장이 근처에서만 룬을 끼울 수 있습니다.' });
  const it = findGear(p, uid);
  const d = it && ITEMS[it.id];
  const rune = p.data.inv.find((x) => x.uid === runeUid);
  if (!it || !d || d.kind !== 'equip' || !rune || ITEMS[rune.id]?.kind !== 'rune') return;
  if (i < 0 || i >= socketCount(it)) return p.send({ t: 'err', text: '그 소켓은 없습니다.' });
  const gold = Math.round(SOCKET_BASE * (1 + d.lv / 10));
  if (p.data.gold < gold) return p.send({ t: 'err', text: `골드가 ${gold.toLocaleString()} 필요합니다.` });
  if (!takeItem(p, runeUid, 1)) return;
  p.data.gold -= gold;
  const sock = Array.from({ length: socketCount(it) }, (_, k) => it.sock?.[k] ?? '');
  sock[i] = rune.id;
  it.sock = sock;
  done(p);
}

/** 룬을 뺀다(룬은 부서진다) */
function unsocket(p: PlayerSession, zone: ZoneDef, uid: string, i: number): void {
  if (!nearNpc(p, zone, 'smith')) return p.send({ t: 'err', text: '대장장이 근처에서만 룬을 뺄 수 있습니다.' });
  const it = findGear(p, uid);
  if (!it?.sock?.[i]) return;
  if (p.data.gold < UNSOCKET_GOLD) return p.send({ t: 'err', text: `골드가 ${UNSOCKET_GOLD} 필요합니다.` });
  p.data.gold -= UNSOCKET_GOLD;
  it.sock[i] = '';
  done(p);
}

function done(p: PlayerSession): void {
  p.dirty = true;
  p.recalc();
  syncInv(p);
  p.send({ t: 'me', s: p.self() });
}

/** 전직: 레벨 30부터, 전직 교관 앞에서 골드를 내고 갈래를 고른다. 바꿀 때는 더 비싸다 */
function chooseBranch(p: PlayerSession, zone: ZoneDef, id: string): void {
  const b = BRANCHES[id];
  if (!b || b.cls !== p.cls) return;
  if (!nearNpc(p, zone, 'skill')) return p.send({ t: 'err', text: '전직 교관 근처에서만 전직할 수 있습니다.' });
  if (p.lv < BRANCH_RULES.unlockLv) return p.send({ t: 'err', text: `레벨 ${BRANCH_RULES.unlockLv}부터 전직할 수 있습니다.` });
  if (p.data.branch === id) return p.send({ t: 'err', text: '이미 이 갈래입니다.' });
  const cost = p.data.branch ? BRANCH_RULES.changeCost : BRANCH_RULES.cost;
  if (p.data.gold < cost) return p.send({ t: 'err', text: `골드가 ${cost.toLocaleString()} 필요합니다.` });
  p.data.gold -= cost;
  p.data.branch = id;
  if (!p.data.branchGrant) {
    p.data.branchGrant = true;
    p.data.skillPoints += BRANCH_RULES.grantPoints;
  }
  p.recalc();
  p.dirty = true;
  p.send({ t: 'me', s: p.self() });
  p.send({ t: 'banner', text: `전직: ${b.name}!`, kind: 'good' });
  p.send({ t: 'sys', text: `${p.name}님이 ${b.name}(으)로 전직했습니다. 전직 스킬 2개는 K 창에서 배우고 5·6번 키로 씁니다.` });
}

/** 스킬 강화 붙이기·바꾸기·떼기(골드, 스킬 레벨 3부터) */
function enhance(p: PlayerSession, skill: string, kind: string): void {
  const def = ACTIONS[skill];
  if (!def || !isSkill(p.cls, skill) || !branchAllows(p.cls, skill, p.data.branch)) return;
  if (kind === '') {
    delete p.data.senh[skill];
  } else {
    if (!isEnh(kind)) return;
    if ((p.data.skills[skill] ?? 0) < ENH_MIN_SLV) return p.send({ t: 'err', text: `스킬 레벨 ${ENH_MIN_SLV}부터 강화할 수 있습니다.` });
    if (p.data.senh[skill] === kind) return;
    const gold = enhPrice(def);
    if (p.data.gold < gold) return p.send({ t: 'err', text: `골드가 ${gold.toLocaleString()} 필요합니다.` });
    p.data.gold -= gold;
    p.data.senh[skill] = kind;
  }
  p.dirty = true;
  p.send({ t: 'me', s: { gold: p.data.gold, senh: { ...p.data.senh } } });
}

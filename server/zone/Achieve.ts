import { ACHS, advance, titleUnlocked, type AchType } from '../../shared/achievements';
import { bountyDay, bountyReward, makeBounties } from '../../shared/bounty';
import { MONSTERS } from '../../shared/data';
import { makeItem } from '../../shared/items';
import type { S2C } from '../../shared/protocol';
import { newUid } from '../db';
import { addItem, syncInv } from './Inventory';
import type { PlayerSession } from './PlayerSession';

export interface AchHost {
  broadcast(m: S2C, except?: PlayerSession): void;
  gainExp(p: PlayerSession, n: number): void;
}

/**
 * 업적·칭호와 현상 수배(하루 3건, 잡으면 바로 보상).
 * 다른 시스템은 PlayerSession.achieve(종류, 대상, 양)로 진행을 알린다.
 */
export class Achievements {
  constructor(private readonly h: AchHost) {}

  /** 접속: 진행 함수를 붙이고 업적·수배 목록을 보낸다 */
  attach(p: PlayerSession): void {
    p.achieve = (type, target, amount = 1) => this.add(p, type, target, amount);
    // 예전에 이미 이룬 레벨·탑 기록을 업적에 반영
    this.add(p, 'level', undefined, p.lv, true);
    if (p.data.tower) this.add(p, 'tower', undefined, p.data.tower, true);
    p.send({ t: 'achs', p: p.data.ach, title: p.data.title });
    this.ensureBounty(p);
    p.send({ t: 'bounty', b: p.data.bounty });
  }

  /** 진행 반영. quiet: 접속할 때 맞춰 넣는 것(알림·보상은 그대로 줌) */
  add(p: PlayerSession, type: AchType, target: string | undefined, amount: number, quiet = false): void {
    const done = advance(p.data.ach, type, target, amount);
    p.dirty = true;
    if (!done.length) return;
    let gold = 0;
    for (const id of done) {
      const a = ACHS[id];
      gold += a.gold ?? 0;
      p.send({ t: 'ach', id });
      if (a.title) this.h.broadcast({ t: 'sys', text: `🏆 ${p.name}님이 업적 [${a.name}]을(를) 달성해 칭호 「${a.title}」을(를) 얻었습니다!` }, quiet ? p : undefined);
    }
    if (gold) {
      p.data.gold += gold;
      p.send({ t: 'me', s: { gold: p.data.gold } });
    }
    p.send({ t: 'achs', p: p.data.ach, title: p.data.title });
  }

  /** 몬스터 처치(파티원 각자): 업적과 현상 수배 */
  onKill(p: PlayerSession, monId: string, elite = false): void {
    this.add(p, 'kill', monId, 1);
    if (MONSTERS[monId]?.boss) this.add(p, 'boss', monId, 1);
    if (elite) this.add(p, 'elite', monId, 1);
    this.bountyKill(p, monId);
  }

  setTitle(p: PlayerSession, id: string): void {
    if (id && !titleUnlocked(p.data.ach, id)) return p.send({ t: 'err', text: '아직 얻지 못한 칭호입니다.' });
    p.data.title = id;
    p.dirty = true;
    p.send({ t: 'achs', p: p.data.ach, title: p.data.title });
    this.h.broadcast({ t: 'pinfo', p: p.info() });
  }

  /** 날짜가 바뀌었으면 오늘의 수배를 새로 만든다 */
  private ensureBounty(p: PlayerSession): boolean {
    const day = bountyDay();
    const b = p.data.bounty;
    if (b.day === day && b.list.length) return false;
    b.day = day;
    b.list = makeBounties(p.id, p.lv, day);
    p.dirty = true;
    return true;
  }

  private bountyKill(p: PlayerSession, monId: string): void {
    const fresh = this.ensureBounty(p);
    const b = p.data.bounty;
    let changed = fresh;
    for (const x of b.list) {
      if (x.done || x.m !== monId) continue;
      x.got++;
      changed = true;
      if (x.got < x.n) continue;
      x.done = true;
      b.total++;
      const r = bountyReward(x, p.lv);
      p.data.gold += r.gold;
      if (r.stones) addItem(p, makeItem('enh_stone', r.stones, newUid()));
      p.send({ t: 'banner', text: `현상 수배 완료! ${MONSTERS[x.m]?.name ?? x.m} — ${r.gold.toLocaleString()} G`, kind: 'good' });
      p.send({ t: 'sys', text: `📜 현상 수배 [${MONSTERS[x.m]?.name}] 완료: 골드 ${r.gold.toLocaleString()}, 경험치 ${r.exp.toLocaleString()}, 강화석 ${r.stones}개` });
      syncInv(p);
      this.h.gainExp(p, r.exp);
      this.add(p, 'bounty', undefined, 1);
    }
    if (changed) {
      p.dirty = true;
      p.send({ t: 'bounty', b });
    }
  }
}

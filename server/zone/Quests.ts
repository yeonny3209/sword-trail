import { dist2 } from '../../shared/geom';
import { ITEMS, makeItem } from '../../shared/items';
import { availableQuests, isComplete, MAX_ACTIVE_QUESTS, QUESTS, type QuestDef } from '../../shared/quests';
import type { ZoneDef } from '../../shared/types';
import { newUid } from '../db';
import { addItem, countItem, removeById, syncInv } from './Inventory';
import type { PlayerSession } from './PlayerSession';

const TALK_RANGE = 5;

/** 퀘스트: 받기·진행(처치·방문)·완료 보상. 수집은 완료할 때 가방에서 확인하고 가져간다 */
export class QuestSystem {
  constructor(private readonly zone: ZoneDef, private readonly gainExp: (p: PlayerSession, n: number) => void) {}

  send(p: PlayerSession): void {
    p.send({ t: 'quests', q: p.data.quests });
  }

  private nearGiver(p: PlayerSession, q: QuestDef): boolean {
    const n = this.zone.npcs.find((x) => x.id === q.giver);
    return !!n && dist2(p.x, p.z, n.x, n.z) <= TALK_RANGE * TALK_RANGE;
  }

  onAccept(p: PlayerSession, id: string): void {
    const q = QUESTS[id];
    const qs = p.data.quests;
    if (!q || !this.nearGiver(p, q)) return;
    if (!availableQuests(qs, q.giver, p.lv).includes(q)) return p.send({ t: 'err', text: '지금은 받을 수 없는 퀘스트입니다.' });
    if (Object.keys(qs.active).length >= MAX_ACTIVE_QUESTS) return p.send({ t: 'err', text: `퀘스트는 ${MAX_ACTIVE_QUESTS}개까지 진행할 수 있습니다.` });
    qs.active[id] = q.obj.map((o) => (o.type === 'visit' && o.target === this.zone.id ? 1 : 0));
    p.dirty = true;
    this.send(p);
    p.send({ t: 'sys', text: `퀘스트 수락: ${q.name}` });
  }

  onAbandon(p: PlayerSession, id: string): void {
    if (!(id in p.data.quests.active)) return;
    delete p.data.quests.active[id];
    p.dirty = true;
    this.send(p);
  }

  private bump(p: PlayerSession, type: 'kill' | 'visit', target: string): void {
    let changed = false;
    for (const [id, prog] of Object.entries(p.data.quests.active)) {
      const q = QUESTS[id];
      q?.obj.forEach((o, i) => {
        if (o.type === type && o.target === target && (prog[i] ?? 0) < o.n) {
          prog[i] = (prog[i] ?? 0) + 1;
          changed = true;
        }
      });
    }
    if (changed) {
      p.dirty = true;
      this.send(p);
    }
  }

  onKill(p: PlayerSession, monsterId: string): void {
    this.bump(p, 'kill', monsterId);
  }

  onEnterZone(p: PlayerSession): void {
    this.bump(p, 'visit', this.zone.id);
  }

  onTurnin(p: PlayerSession, id: string): void {
    const q = QUESTS[id];
    const qs = p.data.quests;
    if (!q || !(id in qs.active) || !this.nearGiver(p, q)) return;
    if (!isComplete(q, qs, (it) => countItem(p, it))) return p.send({ t: 'err', text: '아직 목표를 다 채우지 못했습니다.' });
    for (const o of q.obj) if (o.type === 'collect') removeById(p, o.target, o.n);
    delete qs.active[id];
    qs.done.push(id);
    const r = q.reward;
    if (r.gold) p.data.gold += r.gold;
    for (const [item, n] of r.items ?? []) addItem(p, makeItem(item, n, newUid()));
    if (r.equip) {
      const pool = Object.values(ITEMS).filter((d) => d.kind === 'equip' && d.lv === r.equip!.lv && (!d.cls || d.cls === p.cls));
      const d = pool[Math.floor(Math.random() * pool.length)];
      if (d) addItem(p, makeItem(d.id, 1, newUid(), r.equip.rar));
    }
    p.dirty = true;
    this.send(p);
    p.send({ t: 'qdone', id });
    syncInv(p);
    p.send({ t: 'me', s: { gold: p.data.gold } });
    if (r.exp) this.gainExp(p, r.exp);
  }
}

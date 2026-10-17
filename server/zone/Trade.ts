import { dist2 } from '../../shared/geom';
import type { Item } from '../../shared/items';
import { TRADE_BREAK, TRADE_MAX_ITEMS, TRADE_RANGE, type TradeSide } from '../../shared/market';
import type { C2S } from '../../shared/protocol';
import { addItem, canHold, syncInv, takeItem } from './Inventory';
import type { PlayerSession } from './PlayerSession';

export type TradeMsg = Extract<C2S, { t: 'treq' | 'tans' | 'tset' | 'tready' | 'tcancel' }>;
export const TRADE_MSGS = new Set<string>(['treq', 'tans', 'tset', 'tready', 'tcancel']);

interface Offer {
  id: number;
  items: { uid: string; n: number }[];
  gold: number;
  ready: boolean;
}

interface Deal {
  a: Offer;
  b: Offer;
}

const REQ_MS = 30_000;

/**
 * 같은 존 두 사람의 1:1 거래. 양쪽이 내놓을 것을 정하고 둘 다 '준비'하면 한 번에 바꾼다.
 * 내놓은 것이 바뀌면 준비가 풀린다. 존 DO 안에서 동기적으로 처리하므로 중간 상태가 없다.
 */
export class TradeSystem {
  private readonly reqs = new Map<number, { from: number; at: number }>();
  private readonly deals = new Map<number, Deal>();

  constructor(
    private readonly players: Map<number, PlayerSession>,
    private readonly save: (p: PlayerSession) => Promise<void>,
    private readonly busy: (id: number) => boolean,
  ) {}

  on(p: PlayerSession, m: TradeMsg): void {
    switch (m.t) {
      case 'treq': return this.request(p, m.id | 0);
      case 'tans': return this.answer(p, m.id | 0, !!m.ok);
      case 'tset': return this.set(p, m.items, m.gold);
      case 'tready': return this.ready(p, !!m.ok);
      case 'tcancel': return this.cancel(p.id, `${p.name}님이 거래를 취소했습니다.`);
    }
  }

  private request(p: PlayerSession, id: number): void {
    const o = this.players.get(id);
    if (!o || o === p) return p.send({ t: 'err', text: '거래할 상대를 찾을 수 없습니다.' });
    if (this.deals.has(p.id) || this.deals.has(o.id)) return p.send({ t: 'err', text: '이미 거래 중입니다.' });
    if (p.dead || o.dead) return;
    if (dist2(p.x, p.z, o.x, o.z) > TRADE_RANGE ** 2) return p.send({ t: 'err', text: '조금 더 가까이 가야 거래할 수 있습니다.' });
    this.reqs.set(o.id, { from: p.id, at: Date.now() });
    o.send({ t: 'treq', from: p.id, name: p.name });
    p.send({ t: 'sys', text: `${o.name}님에게 거래를 신청했습니다.` });
  }

  private answer(p: PlayerSession, from: number, ok: boolean): void {
    const r = this.reqs.get(p.id);
    this.reqs.delete(p.id);
    const o = this.players.get(from);
    if (!r || r.from !== from || !o || Date.now() - r.at > REQ_MS) return;
    if (!ok) return o.send({ t: 'sys', text: `${p.name}님이 거래를 거절했습니다.` });
    if (this.deals.has(p.id) || this.deals.has(o.id)) return p.send({ t: 'err', text: '상대가 이미 거래 중입니다.' });
    const deal: Deal = { a: { id: o.id, items: [], gold: 0, ready: false }, b: { id: p.id, items: [], gold: 0, ready: false } };
    this.deals.set(o.id, deal);
    this.deals.set(p.id, deal);
    this.push(deal);
  }

  private mine(deal: Deal, id: number): [Offer, Offer] {
    return deal.a.id === id ? [deal.a, deal.b] : [deal.b, deal.a];
  }

  private set(p: PlayerSession, raw: { uid: string; n: number }[], goldRaw: number): void {
    const deal = this.deals.get(p.id);
    if (!deal) return;
    const [me, other] = this.mine(deal, p.id);
    const items: { uid: string; n: number }[] = [];
    for (const r of (Array.isArray(raw) ? raw : []).slice(0, TRADE_MAX_ITEMS)) {
      const s = p.data.inv.find((x) => x.uid === String(r.uid));
      if (!s || items.some((x) => x.uid === s.uid)) continue;
      items.push({ uid: s.uid, n: Math.max(1, Math.min(s.n, r.n | 0)) });
    }
    me.items = items;
    me.gold = Math.max(0, Math.min(p.data.gold, Math.floor(Number(goldRaw) || 0)));
    me.ready = other.ready = false;
    this.push(deal);
  }

  private ready(p: PlayerSession, ok: boolean): void {
    const deal = this.deals.get(p.id);
    if (!deal) return;
    const [me, other] = this.mine(deal, p.id);
    me.ready = ok;
    if (me.ready && other.ready) void this.execute(deal);
    else this.push(deal);
  }

  /** 지금 가방 기준으로 내놓은 아이템(없어진 것은 빠짐) */
  private offered(p: PlayerSession, o: Offer): Item[] {
    return o.items.flatMap((r) => {
      const s = p.data.inv.find((x) => x.uid === r.uid);
      return s && s.n >= r.n ? [{ ...s, n: r.n }] : [];
    });
  }

  private async execute(deal: Deal): Promise<void> {
    const pa = this.players.get(deal.a.id), pb = this.players.get(deal.b.id);
    if (!pa || !pb) return this.end(deal, false, '상대가 없어 거래가 취소되었습니다.');
    if (this.busy(pa.id) || this.busy(pb.id)) {
      deal.a.ready = deal.b.ready = false;
      this.push(deal);
      return pa.send({ t: 'err', text: '다른 처리가 끝난 뒤 다시 준비해 주세요.' });
    }
    const ia = this.offered(pa, deal.a), ib = this.offered(pb, deal.b);
    const valid = ia.length === deal.a.items.length && ib.length === deal.b.items.length && pa.data.gold >= deal.a.gold && pb.data.gold >= deal.b.gold;
    if (!valid) {
      deal.a.ready = deal.b.ready = false;
      this.push(deal);
      return;
    }
    if (!canHold(pa, ib, deal.a.items)) return this.fail(deal, `${pa.name}님의 가방에 자리가 없습니다.`);
    if (!canHold(pb, ia, deal.b.items)) return this.fail(deal, `${pb.name}님의 가방에 자리가 없습니다.`);
    // 여기부터는 기다림 없이 한 번에 바꾼다
    for (const r of deal.a.items) takeItem(pa, r.uid, r.n);
    for (const r of deal.b.items) takeItem(pb, r.uid, r.n);
    for (const it of ib) addItem(pa, it);
    for (const it of ia) addItem(pb, it);
    pa.data.gold += deal.b.gold - deal.a.gold;
    pb.data.gold += deal.a.gold - deal.b.gold;
    pa.dirty = pb.dirty = true;
    this.end(deal, true, '거래가 완료되었습니다.');
    for (const q of [pa, pb]) {
      syncInv(q);
      q.send({ t: 'me', s: { gold: q.data.gold } });
    }
    await Promise.all([this.save(pa), this.save(pb)]);
  }

  private fail(deal: Deal, text: string): void {
    deal.a.ready = deal.b.ready = false;
    this.push(deal);
    for (const id of [deal.a.id, deal.b.id]) this.players.get(id)?.send({ t: 'err', text });
  }

  private side(p: PlayerSession | undefined, o: Offer): TradeSide {
    return { items: p ? this.offered(p, o) : [], gold: o.gold, ready: o.ready };
  }

  private push(deal: Deal): void {
    const pa = this.players.get(deal.a.id), pb = this.players.get(deal.b.id);
    pa?.send({ t: 'trade', name: pb?.name ?? '', mine: this.side(pa, deal.a), theirs: this.side(pb, deal.b) });
    pb?.send({ t: 'trade', name: pa?.name ?? '', mine: this.side(pb, deal.b), theirs: this.side(pa, deal.a) });
  }

  private end(deal: Deal, ok: boolean, text: string): void {
    for (const id of [deal.a.id, deal.b.id]) {
      this.deals.delete(id);
      this.players.get(id)?.send({ t: 'tend', ok, text });
    }
  }

  cancel(id: number, text: string): void {
    const deal = this.deals.get(id);
    if (deal) this.end(deal, false, text);
  }

  onLeave(p: PlayerSession): void {
    this.reqs.delete(p.id);
    this.cancel(p.id, `${p.name}님이 떠나 거래가 취소되었습니다.`);
  }

  /** 1초마다: 멀어지거나 쓰러지면 취소 */
  update(): void {
    for (const [id, deal] of this.deals) {
      if (id !== deal.a.id) continue;
      const pa = this.players.get(deal.a.id), pb = this.players.get(deal.b.id);
      if (!pa || !pb || pa.dead || pb.dead || dist2(pa.x, pa.z, pb.x, pb.z) > TRADE_BREAK ** 2) this.end(deal, false, '거리가 멀어져 거래가 취소되었습니다.');
    }
  }
}

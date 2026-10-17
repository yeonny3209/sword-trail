import { ITEMS, type Item } from '../../shared/items';
import {
  AH_CATEGORIES, AUCTION_HOURS, AUCTION_MAX, AUCTION_MAX_PRICE, AUCTION_PAGE, auctionProceeds, categoryOf,
  MAIL_FEE, MAIL_KEEP_DAYS, type AhCategory, type AuctionRow, type MailRow,
} from '../../shared/market';
import { NAME_RE, type C2S } from '../../shared/protocol';
import type { NpcDef, ZoneDef } from '../../shared/types';
import type { Env } from '../env';
import { addItem, canHold, nearNpc, syncInv, takeItem } from './Inventory';
import type { PlayerSession } from './PlayerSession';

export interface MarketHost {
  env: Env;
  zone: ZoneDef;
  save(p: PlayerSession): Promise<void>;
  /** 접속 중이면 알림(소셜 DO) */
  notify(id: number, text: string): void;
}

export type MarketMsg = Extract<C2S, { t: 'ahsearch' | 'ahmine' | 'ahsell' | 'ahbuy' | 'ahcancel' | 'mlist' | 'mtake' | 'mdel' | 'msend' }>;
export const MARKET_MSGS = new Set<string>(['ahsearch', 'ahmine', 'ahsell', 'ahbuy', 'ahcancel', 'mlist', 'mtake', 'mdel', 'msend']);

interface AuctionDb { id: number; seller_id: number; seller_name: string; item: string; price: number; expires_at: number; name: string; n: number }
interface MailDb { id: number; from_name: string; subject: string; body: string; gold: number; item: string | null; read: number; created_at: number }

const CATS = new Set(AH_CATEGORIES.map(([c]) => c));

function toAuction(r: AuctionDb): AuctionRow {
  return { id: r.id, seller: r.seller_name, item: JSON.parse(r.item) as Item, price: r.price, expires: r.expires_at };
}

function toMail(r: MailDb): MailRow {
  return { id: r.id, from: r.from_name, subject: r.subject, body: r.body, gold: r.gold, item: r.item ? (JSON.parse(r.item) as Item) : null, at: r.created_at, read: !!r.read };
}

function label(it: Item): string {
  return `${ITEMS[it.id]?.name ?? it.id}${it.n > 1 ? ` ${it.n}개` : ''}`;
}

/**
 * 경매장(즉시 구매가)과 우편함. 행은 D1에 두고, 가방·골드는 존 DO의 플레이어 상태를 바꾼 뒤 바로 저장한다.
 * 같은 물건을 두 번 받지 않도록 "DELETE/UPDATE ... RETURNING"으로 한 사람만 가져가게 한다.
 */
export class Market {
  private lastExpire = 0;
  /** 플레이어마다 요청을 하나씩 차례로 처리한다(기다리는 개수) */
  private readonly queue = new Map<number, { tail: Promise<void>; n: number }>();

  constructor(private readonly h: MarketHost) {}

  private get db(): D1Database {
    return this.h.env.DB;
  }

  isBusy(id: number): boolean {
    return this.queue.has(id);
  }

  async on(p: PlayerSession, m: MarketMsg): Promise<void> {
    const q = this.queue.get(p.id) ?? { tail: Promise.resolve(), n: 0 };
    if (q.n >= 4) return p.send({ t: 'err', text: '처리 중입니다. 잠시 후 다시 해 주세요.' });
    q.n++;
    const run = q.tail.then(() => this.handle(p, m));
    q.tail = run;
    this.queue.set(p.id, q);
    await run;
    if (--q.n === 0) this.queue.delete(p.id);
  }

  private async handle(p: PlayerSession, m: MarketMsg): Promise<void> {
    const role: NpcDef['role'] = m.t.startsWith('ah') ? 'auction' : 'mail';
    if (!nearNpc(p, this.h.zone, role)) return p.send({ t: 'err', text: role === 'auction' ? '경매인 근처에서만 이용할 수 있습니다.' : '우체부 근처에서만 이용할 수 있습니다.' });
    try {
      switch (m.t) {
        case 'ahsearch': return await this.search(p, String(m.q ?? ''), m.cat, m.page | 0);
        case 'ahmine': return await this.mine(p);
        case 'ahsell': return await this.sell(p, String(m.uid), m.n | 0, Math.floor(Number(m.price)));
        case 'ahbuy': return await this.buy(p, m.id | 0);
        case 'ahcancel': return await this.cancel(p, m.id | 0);
        case 'mlist': return await this.list(p);
        case 'mtake': return await this.take(p, m.id | 0);
        case 'mdel': return await this.del(p, m.id | 0);
        case 'msend': return await this.send(p, m);
      }
    } catch (e) {
      console.error(e);
      p.send({ t: 'err', text: '처리 중 오류가 났습니다.' });
    }
  }

  /** 접속할 때: 읽지 않은 우편 수 */
  async onConnect(p: PlayerSession): Promise<void> {
    const r = await this.db.prepare('SELECT COUNT(*) AS c FROM mail WHERE to_id = ? AND read = 0').bind(p.id).first<{ c: number }>();
    if (r?.c) p.send({ t: 'mailnew', n: r.c });
  }

  private mailStmt(to: number, from: string, subject: string, body: string, gold: number, item: Item | string | null): D1PreparedStatement {
    const json = item === null ? null : typeof item === 'string' ? item : JSON.stringify(item);
    return this.db.prepare('INSERT INTO mail (to_id, from_name, subject, body, gold, item, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(to, from, subject, body, gold, json, Date.now());
  }

  /** 기한이 지난 경매 물품은 우편으로 돌려주고, 오래된 빈 우편은 지운다(1분에 한 번) */
  private async expire(): Promise<void> {
    const now = Date.now();
    if (now - this.lastExpire < 60_000) return;
    this.lastExpire = now;
    const { results } = await this.db.prepare('DELETE FROM auctions WHERE expires_at <= ? RETURNING seller_id, item, name, n').bind(now)
      .all<{ seller_id: number; item: string; name: string; n: number }>();
    const stmts = results.map((r) => this.mailStmt(r.seller_id, '경매장', `기한 만료: ${r.name}${r.n > 1 ? ` ${r.n}개` : ''}`, '팔리지 않아 돌려드립니다.', 0, r.item));
    stmts.push(this.db.prepare('DELETE FROM mail WHERE created_at < ? AND gold = 0 AND item IS NULL').bind(now - MAIL_KEEP_DAYS * 86_400_000));
    await this.db.batch(stmts);
  }

  // ───────── 경매장 ─────────
  private async search(p: PlayerSession, q: string, cat: AhCategory, page: number): Promise<void> {
    await this.expire();
    const where = ['expires_at > ?'];
    const args: (string | number)[] = [Date.now()];
    if (cat !== 'all' && CATS.has(cat)) {
      where.push('cat = ?');
      args.push(cat);
    }
    const text = q.replace(/[%_]/g, '').trim().slice(0, 20);
    if (text) {
      where.push('name LIKE ?');
      args.push(`%${text}%`);
    }
    page = Math.max(0, page);
    const w = where.join(' AND ');
    const [rows, cnt] = await this.db.batch<AuctionDb | { c: number }>([
      this.db.prepare(`SELECT * FROM auctions WHERE ${w} ORDER BY CAST(price AS REAL) / n, id LIMIT ? OFFSET ?`).bind(...args, AUCTION_PAGE, page * AUCTION_PAGE),
      this.db.prepare(`SELECT COUNT(*) AS c FROM auctions WHERE ${w}`).bind(...args),
    ]);
    p.send({ t: 'ah', rows: (rows.results as AuctionDb[]).map(toAuction), total: (cnt.results[0] as { c: number }).c, page, mine: false });
  }

  private async mine(p: PlayerSession): Promise<void> {
    await this.expire();
    const { results } = await this.db.prepare('SELECT * FROM auctions WHERE seller_id = ? ORDER BY id DESC').bind(p.id).all<AuctionDb>();
    p.send({ t: 'ah', rows: results.map(toAuction), total: results.length, page: 0, mine: true });
  }

  private async sell(p: PlayerSession, uid: string, n: number, price: number): Promise<void> {
    const s = p.data.inv.find((x) => x.uid === uid);
    const d = s && ITEMS[s.id];
    if (!s || !d) return p.send({ t: 'err', text: '가방에 없는 아이템입니다.' });
    n = Math.max(1, Math.min(s.n, n));
    if (!Number.isFinite(price) || price < 1 || price > AUCTION_MAX_PRICE) return p.send({ t: 'err', text: '가격을 다시 정해 주세요.' });
    const cnt = await this.db.prepare('SELECT COUNT(*) AS c FROM auctions WHERE seller_id = ?').bind(p.id).first<{ c: number }>();
    if ((cnt?.c ?? 0) >= AUCTION_MAX) return p.send({ t: 'err', text: `경매 물품은 ${AUCTION_MAX}개까지 올릴 수 있습니다.` });
    // 기다리는 사이 가방이 바뀌었을 수 있으니 여기서 꺼낸다. 먼저 저장해야 복제가 생기지 않는다
    const it = takeItem(p, uid, n);
    if (!it) return p.send({ t: 'err', text: '가방에 없는 아이템입니다.' });
    await this.h.save(p);
    const now = Date.now();
    await this.db.prepare('INSERT INTO auctions (seller_id, seller_name, item_id, name, cat, lv, n, item, price, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(p.id, p.name, it.id, d.name, categoryOf(d), d.lv, it.n, JSON.stringify(it), price, now, now + AUCTION_HOURS * 3_600_000).run();
    syncInv(p);
    p.send({ t: 'sys', text: `경매장에 올렸습니다: ${label(it)} — ${price.toLocaleString()} G` });
    await this.mine(p);
  }

  private async buy(p: PlayerSession, id: number): Promise<void> {
    const row = await this.db.prepare('SELECT * FROM auctions WHERE id = ? AND expires_at > ?').bind(id, Date.now()).first<AuctionDb>();
    if (!row) return p.send({ t: 'err', text: '이미 팔렸거나 내려간 물품입니다.' });
    if (row.seller_id === p.id) return p.send({ t: 'err', text: '내가 올린 물품입니다.' });
    const it = JSON.parse(row.item) as Item;
    const ok = () => p.data.gold >= row.price && canHold(p, [it]);
    if (!ok()) return p.send({ t: 'err', text: p.data.gold < row.price ? '골드가 부족합니다.' : '가방에 자리가 없습니다.' });
    // 한 사람만 가져가도록 지우면서 확보
    const got = await this.db.prepare('DELETE FROM auctions WHERE id = ? RETURNING id').bind(id).first<{ id: number }>();
    if (!got) return p.send({ t: 'err', text: '방금 다른 사람이 샀습니다.' });
    if (!ok()) {
      // 기다리는 사이 골드·가방이 바뀌었다 → 되돌린다
      await this.db.prepare('INSERT INTO auctions (id, seller_id, seller_name, item_id, name, cat, lv, n, item, price, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(row.id, row.seller_id, row.seller_name, it.id, row.name, categoryOf(ITEMS[it.id]), ITEMS[it.id]?.lv ?? 1, row.n, row.item, row.price, Date.now(), row.expires_at).run();
      return p.send({ t: 'err', text: '골드나 가방 자리가 부족합니다.' });
    }
    p.data.gold -= row.price;
    addItem(p, it);
    await this.h.save(p);
    const proceeds = auctionProceeds(row.price);
    await this.mailStmt(row.seller_id, '경매장', `판매 완료: ${label(it)}`,
      `${p.name}님이 ${row.price.toLocaleString()} G에 샀습니다. 수수료를 뺀 ${proceeds.toLocaleString()} G를 보내 드립니다.`, proceeds, null).run();
    this.h.notify(row.seller_id, `경매장에서 팔렸습니다: ${label(it)} — 우편함을 확인하세요.`);
    syncInv(p);
    p.send({ t: 'me', s: { gold: p.data.gold } });
    p.send({ t: 'sys', text: `샀습니다: ${label(it)} — ${row.price.toLocaleString()} G` });
    bump(p);
  }

  private async cancel(p: PlayerSession, id: number): Promise<void> {
    const row = await this.db.prepare('DELETE FROM auctions WHERE id = ? AND seller_id = ? RETURNING item').bind(id, p.id).first<{ item: string }>();
    if (!row) return p.send({ t: 'err', text: '이미 팔렸거나 내려간 물품입니다.' });
    const it = JSON.parse(row.item) as Item;
    if (canHold(p, [it])) {
      addItem(p, it);
      await this.h.save(p);
      syncInv(p);
      p.send({ t: 'sys', text: `경매에서 내렸습니다: ${label(it)}` });
    } else {
      await this.mailStmt(p.id, '경매장', `등록 취소: ${label(it)}`, '가방이 가득 차서 우편으로 보냅니다.', 0, it).run();
      p.send({ t: 'sys', text: '가방이 가득 차서 우편함으로 보냈습니다.' });
    }
    await this.mine(p);
  }

  // ───────── 우편함 ─────────
  private async list(p: PlayerSession): Promise<void> {
    await this.expire();
    const { results } = await this.db.prepare('SELECT * FROM mail WHERE to_id = ? ORDER BY id DESC LIMIT 50').bind(p.id).all<MailDb>();
    p.send({ t: 'mail', rows: results.map(toMail) });
    if (results.some((r) => !r.read)) await this.db.prepare('UPDATE mail SET read = 1 WHERE to_id = ? AND read = 0').bind(p.id).run();
  }

  private async take(p: PlayerSession, id: number): Promise<void> {
    const row = await this.db.prepare('SELECT * FROM mail WHERE id = ? AND to_id = ?').bind(id, p.id).first<MailDb>();
    if (!row || (!row.gold && !row.item)) return this.list(p);
    const it = row.item ? (JSON.parse(row.item) as Item) : null;
    if (it && !canHold(p, [it])) return p.send({ t: 'err', text: '가방에 자리가 없습니다.' });
    const got = await this.db.prepare('UPDATE mail SET gold = 0, item = NULL, read = 1 WHERE id = ? AND to_id = ? AND (gold > 0 OR item IS NOT NULL) RETURNING id').bind(id, p.id).first();
    if (!got) return this.list(p);
    if (it && !canHold(p, [it])) {
      await this.db.prepare('UPDATE mail SET gold = ?, item = ? WHERE id = ?').bind(row.gold, row.item, id).run();
      return p.send({ t: 'err', text: '가방에 자리가 없습니다.' });
    }
    p.data.gold += row.gold;
    if (it) addItem(p, it);
    await this.h.save(p);
    syncInv(p);
    p.send({ t: 'me', s: { gold: p.data.gold } });
    p.send({ t: 'sys', text: `우편에서 받았습니다: ${[row.gold ? `${row.gold.toLocaleString()} G` : '', it ? label(it) : ''].filter(Boolean).join(', ')}` });
    await this.list(p);
  }

  private async del(p: PlayerSession, id: number): Promise<void> {
    const r = await this.db.prepare('DELETE FROM mail WHERE id = ? AND to_id = ? AND gold = 0 AND item IS NULL RETURNING id').bind(id, p.id).first();
    if (!r) p.send({ t: 'err', text: '첨부물을 먼저 받아야 지울 수 있습니다.' });
    await this.list(p);
  }

  private async send(p: PlayerSession, m: Extract<C2S, { t: 'msend' }>): Promise<void> {
    const to = String(m.to ?? '').trim();
    if (!NAME_RE.test(to)) return p.send({ t: 'err', text: '받는 사람 이름을 확인해 주세요.' });
    const target = await this.db.prepare('SELECT id, name FROM characters WHERE name = ? COLLATE NOCASE').bind(to).first<{ id: number; name: string }>();
    if (!target) return p.send({ t: 'err', text: `${to}(이)라는 캐릭터가 없습니다.` });
    if (target.id === p.id) return p.send({ t: 'err', text: '자신에게는 보낼 수 없습니다.' });
    const gold = Math.max(0, Math.floor(Number(m.gold) || 0));
    const subject = String(m.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 30) || '(제목 없음)';
    const body = String(m.body ?? '').slice(0, 300);
    if (p.data.gold < gold + MAIL_FEE) return p.send({ t: 'err', text: `골드가 부족합니다(보내는 값 ${MAIL_FEE} G 포함).` });
    let it: Item | null = null;
    if (m.uid) {
      const s = p.data.inv.find((x) => x.uid === m.uid);
      if (!s) return p.send({ t: 'err', text: '가방에 없는 아이템입니다.' });
      it = takeItem(p, s.uid, Math.max(1, Math.min(s.n, (m.n ?? s.n) | 0)));
      if (!it) return;
    }
    p.data.gold -= gold + MAIL_FEE;
    p.dirty = true;
    await this.h.save(p);
    await this.mailStmt(target.id, p.name, subject, body, gold, it).run();
    this.h.notify(target.id, `${p.name}님에게서 우편이 왔습니다.`);
    syncInv(p);
    p.send({ t: 'me', s: { gold: p.data.gold } });
    p.send({ t: 'sys', text: `${target.name}님에게 우편을 보냈습니다.` });
    await this.list(p);
  }
}

/** 구매 직후 목록을 새로 받도록 클라이언트가 다시 검색한다(서버는 알림만) */
function bump(p: PlayerSession): void {
  p.send({ t: 'ah', rows: [], total: -1, page: 0, mine: false });
}

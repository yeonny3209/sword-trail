import { bus } from '../core/bus';
import { ITEMS, itemName, rarityColor, type Item } from '../../shared/items';
import {
  AH_CATEGORIES, AUCTION_CUT, AUCTION_HOURS, AUCTION_MAX, AUCTION_PAGE, auctionProceeds, MAIL_FEE,
  type AhCategory, type AuctionRow, type MailRow,
} from '../../shared/market';
import type { C2S } from '../../shared/protocol';
import type { InventoryWindow } from './InventoryWindow';
import { itemCell, itemTip, Tooltip } from './ItemView';
import { Window } from './Window';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** 아이템 이름(장비는 등급 색) */
export function nameHtml(it: Item): string {
  const d = ITEMS[it.id];
  return `<span style="color:${d?.kind === 'equip' ? rarityColor(it.rar) : '#e8d8b0'}">${esc(itemName(it))}</span>${it.n > 1 ? ` <small>×${it.n}</small>` : ''}`;
}

/** 칸에 툴팁 달기: data-k 번호로 items에서 찾는다 */
export function bindCells(root: HTMLElement, items: Item[]): void {
  root.querySelectorAll<HTMLDivElement>('[data-k]').forEach((c) => {
    const it = items[Number(c.dataset.k)];
    if (!it) return;
    const show = (e: MouseEvent) => Tooltip.show(itemTip(it), e.clientX, e.clientY);
    c.addEventListener('mouseenter', show);
    c.addEventListener('mousemove', show);
    c.addEventListener('mouseleave', () => Tooltip.hide());
  });
}

function cell(it: Item, k: number): string {
  return `<span class="kcell" data-k="${k}">${itemCell(it)}</span>`;
}

function timeLeft(at: number): string {
  const m = Math.max(0, Math.round((at - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
}

/** 경매장(경매인 세이): 구매·판매·내 물품 */
export class AuctionWindow extends Window {
  private tab: 'buy' | 'sell' | 'mine' = 'buy';
  private q = '';
  private cat: AhCategory = 'all';
  private page = 0;
  private rows: AuctionRow[] = [];
  private total = 0;
  private mineRows: AuctionRow[] = [];
  private pick: Item | null = null;

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void, private readonly inv: InventoryWindow) {
    super(ui, '경매장', '', 'auction-win');
    bus.on('net', (m) => {
      if (m.t !== 'ah') return;
      if (m.total === -1) return this.search();
      if (m.mine) this.mineRows = m.rows;
      else {
        this.rows = m.rows;
        this.total = m.total;
        this.page = m.page;
      }
      this.draw();
    });
  }

  private readonly picker = (it: Item): boolean => {
    if (!this.isOpen || Object.values(this.inv.equip).some((e) => e?.uid === it.uid)) return false;
    this.pick = it;
    this.tab = 'sell';
    this.draw();
    return true;
  };

  openAuction(): void {
    this.open();
    this.inv.open();
    this.inv.picker = this.picker;
    this.search();
    this.send({ t: 'ahmine' });
  }

  close(): void {
    if (this.inv.picker === this.picker) this.inv.picker = null;
    Tooltip.hide();
    super.close();
  }

  private search(page = 0): void {
    this.send({ t: 'ahsearch', q: this.q, cat: this.cat, page });
  }

  draw(): void {
    if (!this.isOpen) return;
    const t = (id: string, n: string) => `<button class="tab ${this.tab === id ? 'on' : ''}" data-t="${id}">${n}</button>`;
    this.body.innerHTML = `<div class="tabs">${t('buy', '구매')}${t('sell', '판매')}${t('mine', `내 물품 ${this.mineRows.length}/${AUCTION_MAX}`)}</div>` +
      (this.tab === 'buy' ? this.buyHtml() : this.tab === 'sell' ? this.sellHtml() : this.mineHtml());
    this.body.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.t as typeof this.tab;
      if (this.tab === 'mine') this.send({ t: 'ahmine' });
      this.draw();
    }));
    if (this.tab === 'buy') this.bindBuy();
    else if (this.tab === 'sell') this.bindSell();
    else this.bindMine();
  }

  private row(r: AuctionRow, k: number, btn: string): string {
    const unit = r.item.n > 1 ? `<small>개당 ${Math.round(r.price / r.item.n).toLocaleString()}</small>` : '';
    return `<div class="ah-row">${cell(r.item, k)}
      <div class="nm">${nameHtml(r.item)} <small>Lv${ITEMS[r.item.id]?.lv ?? 1}</small><div class="sub">${esc(r.seller)} · ${timeLeft(r.expires)} 남음</div></div>
      <div class="price"><b>${r.price.toLocaleString()} G</b>${unit}</div>${btn.replace('{id}', String(r.id))}</div>`;
  }

  private buyHtml(): string {
    const pages = Math.max(1, Math.ceil(this.total / AUCTION_PAGE));
    return `<div class="row ah-search"><input class="q" maxlength="20" placeholder="아이템 이름" value="${esc(this.q)}">
      <select class="cat">${AH_CATEGORIES.map(([c, n]) => `<option value="${c}" ${c === this.cat ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn small go">검색</button></div>
      <div class="ah-list">${this.rows.length ? this.rows.map((r, i) => this.row(r, i, `<button class="btn small buy" data-id="{id}">구매</button>`)).join('') : '<div class="hint">물품이 없습니다.</div>'}</div>
      <div class="row pager"><button class="btn small prev" ${this.page <= 0 ? 'disabled' : ''}>◀</button><span>${this.page + 1} / ${pages} (${this.total}개)</span>
      <button class="btn small next" ${this.page + 1 >= pages ? 'disabled' : ''}>▶</button><span class="gold">💰 ${this.inv.gold.toLocaleString()} G</span></div>`;
  }

  private bindBuy(): void {
    const b = this.body;
    const go = () => {
      this.q = (b.querySelector('.q') as HTMLInputElement).value.trim();
      this.cat = (b.querySelector('.cat') as HTMLSelectElement).value as AhCategory;
      this.search();
    };
    b.querySelector('.go')!.addEventListener('click', go);
    b.querySelector('.q')!.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && go());
    b.querySelector('.cat')!.addEventListener('change', go);
    b.querySelector('.prev')!.addEventListener('click', () => this.search(this.page - 1));
    b.querySelector('.next')!.addEventListener('click', () => this.search(this.page + 1));
    b.querySelectorAll<HTMLButtonElement>('.buy').forEach((bt) => bt.addEventListener('click', () => {
      const r = this.rows.find((x) => x.id === Number(bt.dataset.id));
      if (r && confirm(`${itemName(r.item)}${r.item.n > 1 ? ` ${r.item.n}개` : ''}를 ${r.price.toLocaleString()} G에 살까요?`)) this.send({ t: 'ahbuy', id: r.id });
    }));
    bindCells(b, this.rows.map((r) => r.item));
  }

  private sellHtml(): string {
    const it = this.pick && this.inv.inv.find((s) => s.uid === this.pick!.uid);
    if (!it) return `<div class="hint">가방(인벤토리)에서 팔 아이템을 누르세요.<br>판매되면 수수료 ${AUCTION_CUT * 100}%를 뺀 골드가 우편으로 옵니다. 등록 기간 ${AUCTION_HOURS}시간, 팔리지 않으면 우편으로 돌아옵니다.</div>`;
    const base = (ITEMS[it.id]?.price ?? 1) * it.n;
    return `<div class="ah-sell"><div class="row">${cell(it, 0)}<div>${nameHtml(it)}</div></div>
      ${it.n > 1 ? `<label>수량 <input class="n" type="number" min="1" max="${it.n}" value="${it.n}"></label>` : ''}
      <label>즉시 구매가(묶음 전체) <input class="price" type="number" min="1" value="${base}"> G</label>
      <div class="hint proceeds"></div>
      <div class="row end"><button class="btn small cancel">다른 것 고르기</button><button class="btn small primary reg">등록</button></div></div>`;
  }

  private bindSell(): void {
    const b = this.body;
    const it = this.pick && this.inv.inv.find((s) => s.uid === this.pick!.uid);
    if (!it) return;
    bindCells(b, [it]);
    const price = b.querySelector('.price') as HTMLInputElement;
    const nIn = b.querySelector<HTMLInputElement>('.n');
    const upd = () => {
      (b.querySelector('.proceeds') as HTMLElement).textContent = `팔리면 받는 골드: ${auctionProceeds(Number(price.value) || 0).toLocaleString()} G`;
    };
    price.addEventListener('input', upd);
    upd();
    b.querySelector('.cancel')!.addEventListener('click', () => {
      this.pick = null;
      this.draw();
    });
    b.querySelector('.reg')!.addEventListener('click', () => {
      const p = Math.floor(Number(price.value));
      if (!p || p < 1) return;
      this.send({ t: 'ahsell', uid: it.uid, n: nIn ? Number(nIn.value) || it.n : 1, price: p });
      this.pick = null;
      this.tab = 'mine';
    });
  }

  private mineHtml(): string {
    return `<div class="ah-list">${this.mineRows.length ? this.mineRows.map((r, i) => this.row(r, i, `<button class="btn small cancel" data-id="{id}">내리기</button>`)).join('') : '<div class="hint">올린 물품이 없습니다.</div>'}</div>`;
  }

  private bindMine(): void {
    this.body.querySelectorAll<HTMLButtonElement>('.cancel').forEach((bt) => bt.addEventListener('click', () => this.send({ t: 'ahcancel', id: Number(bt.dataset.id) })));
    bindCells(this.body, this.mineRows.map((r) => r.item));
  }
}

/** 우편함(우체부 고미): 받은 우편·보내기 */
export class MailWindow extends Window {
  private tab: 'in' | 'send' = 'in';
  private rows: MailRow[] = [];
  private attach: Item | null = null;
  private draft = { to: '', subject: '', body: '', gold: 0 };
  /** 보내기를 눌렀고 결과를 기다리는 중(성공하면 서버가 목록을 다시 보낸다) */
  private sending = false;

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void, private readonly inv: InventoryWindow) {
    super(ui, '우편함', '', 'mail-win');
    bus.on('net', (m) => {
      if (m.t === 'err') this.sending = false;
      if (m.t !== 'mail') return;
      this.rows = m.rows;
      if (this.sending) {
        this.sending = false;
        this.body.innerHTML = '';
        this.draft = { to: '', subject: '', body: '', gold: 0 };
        this.attach = null;
        this.tab = 'in';
      }
      this.draw();
    });
  }

  private readonly picker = (it: Item): boolean => {
    if (!this.isOpen || Object.values(this.inv.equip).some((e) => e?.uid === it.uid)) return false;
    this.saveDraft();
    this.attach = it;
    this.tab = 'send';
    this.draw();
    return true;
  };

  openMail(to = ''): void {
    if (to) {
      this.draft.to = to;
      this.tab = 'send';
    }
    this.open();
    this.inv.open();
    this.inv.picker = this.picker;
    this.send({ t: 'mlist' });
  }

  close(): void {
    if (this.inv.picker === this.picker) this.inv.picker = null;
    Tooltip.hide();
    super.close();
  }

  draw(): void {
    if (!this.isOpen) return;
    this.saveDraft();
    const t = (id: string, n: string) => `<button class="tab ${this.tab === id ? 'on' : ''}" data-t="${id}">${n}</button>`;
    this.body.innerHTML = `<div class="tabs">${t('in', `받은 우편 ${this.rows.length}`)}${t('send', '보내기')}</div>` + (this.tab === 'in' ? this.inHtml() : this.sendHtml());
    this.body.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.addEventListener('click', () => {
      this.saveDraft();
      this.tab = b.dataset.t as 'in' | 'send';
      this.draw();
    }));
    if (this.tab === 'in') this.bindIn();
    else this.bindSend();
  }

  private inHtml(): string {
    if (!this.rows.length) return '<div class="hint">받은 우편이 없습니다.</div>';
    return `<div class="mail-list">${this.rows.map((r, i) => {
      const has = r.gold > 0 || r.item;
      return `<div class="mail ${r.read ? '' : 'new'}"><div class="mh"><b>${esc(r.subject)}</b><small>${esc(r.from)} · ${new Date(r.at).toLocaleDateString()}</small></div>
        ${r.body ? `<div class="mb">${esc(r.body)}</div>` : ''}
        <div class="row">${r.item ? cell(r.item, i) + nameHtml(r.item) : ''}${r.gold ? `<span class="gold">💰 ${r.gold.toLocaleString()} G</span>` : ''}
        <span style="flex:1"></span>${has ? `<button class="btn small take" data-id="${r.id}">받기</button>` : `<button class="btn small del" data-id="${r.id}">지우기</button>`}</div></div>`;
    }).join('')}</div>`;
  }

  private bindIn(): void {
    const b = this.body;
    b.querySelectorAll<HTMLButtonElement>('.take').forEach((bt) => bt.addEventListener('click', () => this.send({ t: 'mtake', id: Number(bt.dataset.id) })));
    b.querySelectorAll<HTMLButtonElement>('.del').forEach((bt) => bt.addEventListener('click', () => this.send({ t: 'mdel', id: Number(bt.dataset.id) })));
    const items: Item[] = [];
    this.rows.forEach((r, i) => r.item && (items[i] = r.item));
    bindCells(b, items);
  }

  private sendHtml(): string {
    const it = this.attach && this.inv.inv.find((s) => s.uid === this.attach!.uid);
    const d = this.draft;
    return `<div class="mail-send">
      <input class="to" maxlength="12" placeholder="받는 캐릭터 이름" value="${esc(d.to)}">
      <input class="subj" maxlength="30" placeholder="제목" value="${esc(d.subject)}">
      <textarea class="body" maxlength="300" rows="3" placeholder="내용">${esc(d.body)}</textarea>
      <label>골드 <input class="gold-in" type="number" min="0" value="${d.gold}"> G</label>
      <div class="row">첨부: ${it ? `${cell(it, 0)}${nameHtml(it)} <button class="btn small unattach">빼기</button>` : '<span class="hint">가방에서 아이템을 누르면 첨부됩니다</span>'}</div>
      <div class="row end"><span class="hint">보내는 값 ${MAIL_FEE} G</span><button class="btn small primary go">보내기</button></div></div>`;
  }

  private saveDraft(): void {
    const b = this.body;
    const v = (s: string) => (b.querySelector(s) as HTMLInputElement | null)?.value;
    if (!b.querySelector('.to')) return;
    this.draft = { to: v('.to') ?? '', subject: v('.subj') ?? '', body: v('.body') ?? '', gold: Number(v('.gold-in')) || 0 };
  }

  private bindSend(): void {
    const b = this.body;
    const it = this.attach && this.inv.inv.find((s) => s.uid === this.attach!.uid);
    if (it) bindCells(b, [it]);
    b.querySelector('.unattach')?.addEventListener('click', () => {
      this.saveDraft();
      this.attach = null;
      this.draw();
    });
    b.querySelector('.go')!.addEventListener('click', () => {
      this.saveDraft();
      const d = this.draft;
      if (!d.to) return;
      this.sending = true;
      this.send({ t: 'msend', to: d.to, subject: d.subject, body: d.body, gold: d.gold, uid: it?.uid, n: it?.n });
    });
  }
}

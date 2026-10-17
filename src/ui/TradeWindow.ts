import { bus } from '../core/bus';
import { ITEMS, type Item } from '../../shared/items';
import { TRADE_MAX_ITEMS, type TradeSide } from '../../shared/market';
import type { C2S } from '../../shared/protocol';
import type { InventoryWindow } from './InventoryWindow';
import { itemCell, Tooltip } from './ItemView';
import { bindCells, nameHtml } from './MarketWindows';
import { Window } from './Window';

const EMPTY: TradeSide = { items: [], gold: 0, ready: false };

/** 1:1 거래 창: 가방에서 누르면 올리고, 올린 것을 누르면 내린다. 둘 다 '준비'하면 교환 */
export class TradeWindow extends Window {
  private name = '';
  private mine: TradeSide = EMPTY;
  private theirs: TradeSide = EMPTY;
  private offer: { uid: string; n: number }[] = [];
  private gold = 0;
  /** 처음 열릴 때(겹치는 NPC 창 닫기) */
  onOpen: () => void = () => {};

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void, private readonly inv: InventoryWindow, say: (html: string) => void) {
    super(ui, '거래', '', 'trade-win');
    bus.on('net', (m) => {
      if (m.t === 'trade') {
        const first = !this.isOpen;
        this.name = m.name;
        this.mine = m.mine;
        this.theirs = m.theirs;
        this.offer = m.mine.items.map((it) => ({ uid: it.uid, n: it.n }));
        this.gold = m.mine.gold;
        if (first) {
          this.onOpen();
          this.open();
          this.inv.open();
          this.inv.picker = this.picker;
          bus.emit('sfx', { key: 'ui' });
        } else this.draw();
      } else if (m.t === 'tend') {
        say(m.ok ? `<b>${m.text}</b>` : m.text);
        bus.emit('sfx', { key: m.ok ? 'gate' : 'ui' });
        this.mine = this.theirs = EMPTY;
        this.closeQuiet();
      }
    });
  }

  private readonly picker = (it: Item): boolean => {
    if (!this.isOpen || Object.values(this.inv.equip).some((e) => e?.uid === it.uid)) return false;
    if (this.offer.some((o) => o.uid === it.uid)) return true;
    if (this.offer.length >= TRADE_MAX_ITEMS) return true;
    const n = it.n > 1 ? Number(prompt(`${ITEMS[it.id]?.name} 몇 개 올릴까요? (최대 ${it.n})`, String(it.n))) : 1;
    if (!n || n < 1) return true;
    this.offer.push({ uid: it.uid, n: Math.min(it.n, n) });
    this.push();
    return true;
  };

  private push(): void {
    this.send({ t: 'tset', items: this.offer, gold: this.gold });
  }

  /** 서버가 끝냈을 때(취소 메시지를 다시 보내지 않음) */
  private closeQuiet(): void {
    if (this.inv.picker === this.picker) this.inv.picker = null;
    Tooltip.hide();
    super.close();
  }

  close(): void {
    if (this.isOpen) this.send({ t: 'tcancel' });
    this.closeQuiet();
  }

  private sideHtml(s: TradeSide, title: string, mine: boolean, base: number): string {
    const cells = Array.from({ length: TRADE_MAX_ITEMS }, (_, i) => {
      const it = s.items[i];
      return it ? `<span class="kcell ${mine ? 'rm' : ''}" data-k="${base + i}" data-uid="${it.uid}">${itemCell(it)}</span>` : itemCell(undefined);
    }).join('');
    return `<div class="tside ${s.ready ? 'ready' : ''}"><div class="th">${title} ${s.ready ? '<span class="ok">✔ 준비</span>' : ''}</div>
      <div class="tcells">${cells}</div>
      ${mine ? `<label class="tg">💰 <input class="tgold" type="number" min="0" max="${this.inv.gold}" value="${s.gold}"> G</label>` : `<div class="tg">💰 <b>${s.gold.toLocaleString()}</b> G</div>`}
      <div class="tlist">${s.items.map((it) => nameHtml(it)).join(', ') || '<span class="hint">없음</span>'}</div></div>`;
  }

  draw(): void {
    if (!this.isOpen) return;
    this.el.querySelector('.win-head span')!.textContent = `거래 — ${this.name}`;
    this.body.innerHTML = `<div class="tcols">${this.sideHtml(this.mine, '나', true, 0)}${this.sideHtml(this.theirs, this.name, false, 100)}</div>
      <div class="hint">가방의 아이템을 누르면 올리고, 올린 것을 누르면 내립니다. 내용이 바뀌면 준비가 풀립니다.</div>
      <div class="row end"><button class="btn small cancel">취소</button><button class="btn small primary ready">${this.mine.ready ? '준비 풀기' : '준비'}</button></div>`;
    const items: Item[] = [];
    this.mine.items.forEach((it, i) => (items[i] = it));
    this.theirs.items.forEach((it, i) => (items[100 + i] = it));
    bindCells(this.body, items);
    this.body.querySelectorAll<HTMLElement>('.kcell.rm').forEach((c) => c.addEventListener('click', () => {
      this.offer = this.offer.filter((o) => o.uid !== c.dataset.uid);
      Tooltip.hide();
      this.push();
    }));
    const g = this.body.querySelector('.tgold') as HTMLInputElement;
    g.addEventListener('change', () => {
      this.gold = Math.max(0, Math.min(this.inv.gold, Math.floor(Number(g.value) || 0)));
      this.push();
    });
    this.body.querySelector('.cancel')!.addEventListener('click', () => this.close());
    this.body.querySelector('.ready')!.addEventListener('click', () => this.send({ t: 'tready', ok: !this.mine.ready }));
  }
}

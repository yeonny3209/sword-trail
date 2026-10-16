import { bonusLines, enhanceCost, enhanceRate, ITEMS, itemBonus, itemName, LOOT, rarityColor, sellPrice, SHOPS, type Item } from '../../shared/items';
import type { C2S } from '../../shared/protocol';
import type { InventoryWindow } from './InventoryWindow';
import { itemCell, itemTip, Tooltip } from './ItemView';
import { Window } from './Window';

/** 상점: 사기, 그리고 열려 있는 동안 가방 아이템을 누르면 팔기 */
export class ShopWindow extends Window {
  private npc = '';
  private ref = '';

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void, private readonly inv: InventoryWindow) {
    super(ui, '상점', '', 'shop-win');
  }

  openShop(npc: string, ref: string): void {
    this.npc = npc;
    this.ref = ref;
    this.open();
    this.inv.open();
    this.inv.picker = (it) => {
      const d = ITEMS[it.id];
      if (Object.values(this.inv.equip).some((e) => e?.uid === it.uid)) return false;
      const n = it.n > 1 ? Number(prompt(`${d?.name} 몇 개 팔까요? (최대 ${it.n})`, String(it.n))) : 1;
      if (!n || n < 1) return true;
      if ((it.rar ?? 0) >= 2 && !confirm(`${itemName(it)}을(를) ${sellPrice(it) * n}G에 팔까요?`)) return true;
      this.send({ t: 'sell', uid: it.uid, n });
      return true;
    };
  }

  close(): void {
    if (this.inv.picker) this.inv.picker = null;
    super.close();
  }

  draw(): void {
    if (!this.isOpen) return;
    const shop = SHOPS[this.ref];
    this.el.querySelector('.win-head span')!.textContent = shop?.name ?? '상점';
    const rows = (shop?.items ?? []).map((id) => {
      const d = ITEMS[id];
      const stats = d.stats ? bonusLines(d.stats).join(', ') : d.desc ?? '';
      return `<div class="shop-row"><div class="nm">${d.name} <small>Lv${d.lv}</small><div class="desc">${stats}</div></div>
        <b class="price">${d.price.toLocaleString()} G</b>
        ${d.stack ? '<input class="qty" type="number" min="1" max="99" value="1">' : ''}
        <button class="btn small buy" data-id="${id}">사기</button></div>`;
    }).join('');
    this.body.innerHTML = `<div class="hint">가방에서 아이템을 누르면 판매합니다 (판매가 ${Math.round(LOOT.sellRate * 100)}%~)</div>${rows}`;
    this.body.querySelectorAll<HTMLButtonElement>('.buy').forEach((b) => b.addEventListener('click', () => {
      const qty = b.parentElement!.querySelector<HTMLInputElement>('.qty');
      this.send({ t: 'buy', npc: this.npc, id: b.dataset.id!, n: qty ? Number(qty.value) || 1 : 1 });
    }));
  }
}

/** 대장간: 장비 강화(+15까지). 가방이나 장비 칸에서 고른다 */
export class SmithWindow extends Window {
  private pick: Item | null = null;
  private result = '';

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void, private readonly inv: InventoryWindow) {
    super(ui, '대장간 — 강화', '', 'smith-win');
  }

  openSmith(): void {
    this.open();
    this.inv.open();
    this.inv.picker = (it) => {
      if (ITEMS[it.id]?.kind !== 'equip') return false;
      this.pick = it;
      this.result = '';
      this.draw();
      return true;
    };
  }

  close(): void {
    if (this.inv.picker) this.inv.picker = null;
    super.close();
  }

  /** 서버 결과 */
  onResult(ok: boolean, enh: number): void {
    this.result = ok ? `<span class="ok">성공! +${enh}</span>` : `<span class="fail">실패…${enh >= LOOT.enhance.failDropFrom - 1 ? ` (+${enh}로 내려감)` : ''}</span>`;
    this.draw();
  }

  draw(): void {
    if (!this.isOpen) return;
    // 서버 동기화 후 같은 uid의 최신 상태로
    const all = [...this.inv.inv, ...Object.values(this.inv.equip)].filter(Boolean) as Item[];
    const it = this.pick ? all.find((x) => x.uid === this.pick!.uid) ?? null : null;
    if (!it) {
      this.body.innerHTML = '<div class="hint">강화할 장비를 가방이나 장비 칸에서 누르세요.</div>';
      return;
    }
    const e = it.enh ?? 0;
    const cost = enhanceCost(it);
    const stones = this.inv.count('enh_stone');
    const next = { ...it, enh: e + 1 };
    const maxed = e >= LOOT.enhance.max;
    this.body.innerHTML = `
      <div class="smith-item">${itemCell(it)}<div><div style="color:${rarityColor(it.rar)}">${itemName(it)}</div>
        <div class="desc">${bonusLines(itemBonus(it)).join(', ')}</div></div></div>
      ${maxed ? '<div class="hint">최고 단계입니다.</div>' : `
      <div class="kv"><span>다음 단계</span><b>+${e + 1} — ${bonusLines(itemBonus(next)).join(', ')}</b></div>
      <div class="kv"><span>성공 확률</span><b>${Math.round(enhanceRate(e) * 100)}%</b></div>
      <div class="kv"><span>비용</span><b>${cost.gold.toLocaleString()} G · 강화석 ${cost.stones}개 (보유 ${stones})</b></div>
      ${e >= LOOT.enhance.failDropFrom ? '<div class="warn">실패하면 한 단계 내려갑니다.</div>' : ''}
      <div class="row end"><button class="btn primary go" ${this.inv.gold < cost.gold || stones < cost.stones ? 'disabled' : ''}>강화하기</button></div>`}
      <div class="result">${this.result}</div>`;
    const cell = this.body.querySelector<HTMLDivElement>('.cell');
    cell?.addEventListener('mouseenter', (ev) => Tooltip.show(itemTip(it), ev.clientX, ev.clientY));
    cell?.addEventListener('mouseleave', () => Tooltip.hide());
    this.body.querySelector('.go')?.addEventListener('click', () => this.send({ t: 'enhance', uid: it.uid }));
  }
}

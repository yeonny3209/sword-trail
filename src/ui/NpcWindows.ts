import { bonusLines, enhanceCost, enhanceRate, ITEMS, itemBonus, itemName, LOOT, rarityColor, sellPrice, SHOPS, type Item } from '../../shared/items';
import { RECIPE_LIST } from '../../shared/quests';
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

/** 대장간: 강화(+15) 탭과 제작 탭 */
export class SmithWindow extends Window {
  private pick: Item | null = null;
  private result = '';
  private tab: 'enh' | 'craft' = 'enh';
  private craftMsg = '';
  /** 내 레벨(제작 가능 여부) */
  lv: () => number = () => 1;

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void, private readonly inv: InventoryWindow) {
    super(ui, '대장간', '', 'smith-win');
  }

  openSmith(): void {
    this.open();
    this.inv.open();
    this.inv.picker = (it) => {
      if (this.tab !== 'enh' || ITEMS[it.id]?.kind !== 'equip') return false;
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

  onCrafted(id: string, n: number, rar?: number): void {
    const d = ITEMS[id];
    this.craftMsg = `<span class="ok" style="color:${d?.kind === 'equip' ? rarityColor(rar) : ''}">제작 완료: ${d?.name ?? id}${n > 1 ? ` ${n}개` : ''}</span>`;
    this.draw();
  }

  draw(): void {
    if (!this.isOpen) return;
    const tabs = `<div class="tabs"><button class="tab ${this.tab === 'enh' ? 'on' : ''}" data-t="enh">강화</button><button class="tab ${this.tab === 'craft' ? 'on' : ''}" data-t="craft">제작</button></div>`;
    this.body.innerHTML = tabs + (this.tab === 'enh' ? this.enhHtml() : this.craftHtml());
    this.body.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.t as 'enh' | 'craft';
      this.draw();
    }));
    if (this.tab === 'enh') this.bindEnh();
    else this.body.querySelectorAll<HTMLButtonElement>('.mk').forEach((b) => b.addEventListener('click', () => this.send({ t: 'craft', id: b.dataset.id! })));
  }

  private current(): Item | null {
    // 서버 동기화 후 같은 uid의 최신 상태로
    const all = [...this.inv.inv, ...Object.values(this.inv.equip)].filter(Boolean) as Item[];
    return this.pick ? all.find((x) => x.uid === this.pick!.uid) ?? null : null;
  }

  private enhHtml(): string {
    const it = this.current();
    if (!it) return '<div class="hint">강화할 장비를 가방이나 장비 칸에서 누르세요.</div>';
    const e = it.enh ?? 0;
    const cost = enhanceCost(it);
    const stones = this.inv.count('enh_stone');
    const next = { ...it, enh: e + 1 };
    const maxed = e >= LOOT.enhance.max;
    return `
      <div class="smith-item">${itemCell(it)}<div><div style="color:${rarityColor(it.rar)}">${itemName(it)}</div>
        <div class="desc">${bonusLines(itemBonus(it)).join(', ')}</div></div></div>
      ${maxed ? '<div class="hint">최고 단계입니다.</div>' : `
      <div class="kv"><span>다음 단계</span><b>+${e + 1} — ${bonusLines(itemBonus(next)).join(', ')}</b></div>
      <div class="kv"><span>성공 확률</span><b>${Math.round(enhanceRate(e) * 100)}%</b></div>
      <div class="kv"><span>비용</span><b>${cost.gold.toLocaleString()} G · 강화석 ${cost.stones}개 (보유 ${stones})</b></div>
      ${e >= LOOT.enhance.failDropFrom ? '<div class="warn">실패하면 한 단계 내려갑니다.</div>' : ''}
      <div class="row end"><button class="btn primary go" ${this.inv.gold < cost.gold || stones < cost.stones ? 'disabled' : ''}>강화하기</button></div>`}
      <div class="result">${this.result}</div>`;
  }

  private bindEnh(): void {
    const it = this.current();
    if (!it) return;
    const cell = this.body.querySelector<HTMLDivElement>('.smith-item .cell');
    cell?.addEventListener('mouseenter', (ev) => Tooltip.show(itemTip(it), ev.clientX, ev.clientY));
    cell?.addEventListener('mouseleave', () => Tooltip.hide());
    this.body.querySelector('.go')?.addEventListener('click', () => this.send({ t: 'enhance', uid: it.uid }));
  }

  /** 제작법 목록: 내 레벨 +5까지 보여 주고, 재료가 모자라면 흐리게 */
  private craftHtml(): string {
    const lv = this.lv();
    const rows = RECIPE_LIST.filter((r) => r.lv <= lv + 5).map((r) => {
      const d = ITEMS[r.out];
      if (!d) return '';
      const mats = r.need.map(([id, n]) => {
        const have = this.inv.count(id);
        return `<span class="${have >= n ? 'ok' : 'lack'}">${ITEMS[id]?.name ?? id} ${have}/${n}</span>`;
      }).join(' · ');
      const can = lv >= r.lv && this.inv.gold >= r.gold && r.need.every(([id, n]) => this.inv.count(id) >= n);
      const stats = d.stats ? bonusLines(d.stats).join(', ') : d.desc ?? '';
      return `<div class="craft-row ${can ? '' : 'dim'}"><div class="nm">${d.name}${r.n > 1 ? ` ×${r.n}` : ''} <small>Lv${r.lv}${r.minRar ? ' · 고급 이상' : ''}</small>
        <div class="desc">${stats}</div><div class="mats">${mats} · <span class="${this.inv.gold >= r.gold ? 'ok' : 'lack'}">${r.gold.toLocaleString()} G</span></div></div>
        <button class="btn small mk" data-id="${r.id}" ${can ? '' : 'disabled'}>제작</button></div>`;
    }).join('');
    return `<div class="hint">재료는 몬스터와 채집(스페이스)으로 모읍니다. 장비는 고급 이상 등급으로 만들어집니다.</div>
      <div class="result">${this.craftMsg}</div>${rows}`;
  }
}

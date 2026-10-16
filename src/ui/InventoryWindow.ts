import { ITEMS, LOOT, SLOTS, SLOT_NAMES, type Equip, type Item, type Slot } from '../../shared/items';
import type { C2S } from '../../shared/protocol';
import { itemCell, itemTip, Tooltip } from './ItemView';
import { Window } from './Window';

/** 다른 창이 가방 아이템 클릭을 가로채고 싶을 때(상점 판매·강화 선택) */
export type InvPick = (it: Item) => boolean;

/** 인벤토리(I): 장비 칸 + 가방 + 골드. 아이템을 누르면 할 수 있는 일이 뜬다 */
export class InventoryWindow extends Window {
  inv: Item[] = [];
  equip: Equip = {};
  gold = 0;
  /** 상점·대장간이 열려 있으면 클릭을 먼저 넘긴다 */
  picker: InvPick | null = null;
  private menu: HTMLDivElement | null = null;

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void) {
    super(ui, '인벤토리', 'I', 'inv-win');
  }

  set(inv: Item[], equip: Equip, gold: number): void {
    this.inv = inv;
    this.equip = equip;
    this.gold = gold;
    this.draw();
  }

  count(id: string): number {
    return this.inv.filter((s) => s.id === id).reduce((a, s) => a + s.n, 0);
  }

  draw(): void {
    if (!this.isOpen) return;
    const doll = SLOTS.map((s) => `<div class="eq"><small>${SLOT_NAMES[s]}</small>${itemCell(this.equip[s], `eq-${s}`)}</div>`).join('');
    const cells = Array.from({ length: LOOT.invSize }, (_, i) => itemCell(this.inv[i])).join('');
    this.body.innerHTML = `<div class="doll">${doll}</div>
      <div class="bag">${cells}</div>
      <div class="gold">💰 ${this.gold.toLocaleString()} G <small>${this.inv.length}/${LOOT.invSize}칸</small></div>
      <div class="hint">아이템을 클릭하면 장착·사용·버리기 · 상인 앞에서는 판매</div>`;
    this.body.querySelectorAll<HTMLDivElement>('.cell[data-uid]').forEach((c) => {
      const uid = c.dataset.uid!;
      const it = this.find(uid);
      if (!it) return;
      const d = ITEMS[it.id];
      c.addEventListener('mouseenter', (e) => Tooltip.show(itemTip(it, d?.slot ? this.equip[d.slot] : undefined), e.clientX, e.clientY));
      c.addEventListener('mousemove', (e) => Tooltip.show(itemTip(it, d?.slot ? this.equip[d.slot] : undefined), e.clientX, e.clientY));
      c.addEventListener('mouseleave', () => Tooltip.hide());
      c.addEventListener('click', (e) => this.click(it, e));
      c.addEventListener('dblclick', () => this.quick(it));
    });
  }

  private find(uid: string): Item | undefined {
    return this.inv.find((s) => s.uid === uid) ?? Object.values(this.equip).find((s) => s?.uid === uid);
  }

  private equippedSlot(it: Item): Slot | null {
    return (SLOTS.find((s) => this.equip[s]?.uid === it.uid) as Slot | undefined) ?? null;
  }

  /** 더블클릭: 장비는 장착/해제, 물약은 사용 */
  private quick(it: Item): void {
    const slot = this.equippedSlot(it);
    if (slot) this.send({ t: 'unequip', slot });
    else this.send({ t: 'use', uid: it.uid });
  }

  private click(it: Item, e: MouseEvent): void {
    if (this.picker?.(it)) return;
    this.closeMenu();
    const d = ITEMS[it.id];
    const slot = this.equippedSlot(it);
    const acts: [string, () => void][] = [];
    if (slot) acts.push(['해제', () => this.send({ t: 'unequip', slot })]);
    else if (d?.kind === 'equip') acts.push(['장착', () => this.send({ t: 'equip', uid: it.uid })]);
    if (d?.kind === 'potion') acts.push(['사용', () => this.send({ t: 'use', uid: it.uid })]);
    if (!slot) acts.push(['버리기', () => confirm(`${d?.name ?? it.id}을(를) 버릴까요?`) && this.send({ t: 'discard', uid: it.uid })]);
    const m = document.createElement('div');
    m.className = 'ctx';
    m.innerHTML = acts.map(([n], i) => `<button data-i="${i}">${n}</button>`).join('');
    m.style.left = `${e.clientX + 4}px`;
    m.style.top = `${e.clientY + 4}px`;
    document.getElementById('ui')!.appendChild(m);
    m.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      acts[Number(b.dataset.i)][1]();
      this.closeMenu();
    }));
    this.menu = m;
    setTimeout(() => window.addEventListener('mousedown', this.outside), 0);
  }

  private outside = (e: MouseEvent): void => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
  };

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
    window.removeEventListener('mousedown', this.outside);
  }

  close(): void {
    this.closeMenu();
    Tooltip.hide();
    super.close();
  }
}

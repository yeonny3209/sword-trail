import { CLASS_BY_ID } from '../../shared/data';
import {
  bonusLines, ITEMS, itemBonus, itemName, rarityColor, rarityName, SLOT_ICONS, SLOT_NAMES, type Item,
} from '../../shared/items';

/** 아이템 칸 그림(아이콘·등급 테두리·개수·강화) */
export function itemCell(it: Item | undefined, extra = ''): string {
  if (!it) return `<div class="cell empty ${extra}"></div>`;
  const d = ITEMS[it.id];
  const icon = d?.slot ? SLOT_ICONS[d.slot] : d?.kind === 'potion' ? (d.heal?.hp ? '🧪' : '💧') : d?.id === 'enh_stone' ? '💎' : '◆';
  const color = d?.kind === 'equip' ? rarityColor(it.rar) : '#8a7a5a';
  return `<div class="cell ${extra}" data-uid="${it.uid}" style="--rc:${color}">
    <span class="ic">${icon}</span>${it.n > 1 ? `<span class="n">${it.n}</span>` : ''}${it.enh ? `<span class="e">+${it.enh}</span>` : ''}</div>`;
}

/** 툴팁 내용 */
export function itemTip(it: Item, equipped?: Item): string {
  const d = ITEMS[it.id];
  if (!d) return it.id;
  const head = `<div class="tt-name" style="color:${d.kind === 'equip' ? rarityColor(it.rar) : '#e8d8b0'}">${itemName(it)}</div>`;
  const lines: string[] = [];
  if (d.kind === 'equip') {
    lines.push(`<div class="tt-sub">${rarityName(it.rar)} ${SLOT_NAMES[d.slot!]}${d.cls ? ` · ${CLASS_BY_ID[d.cls].name} 전용` : ''} · 레벨 ${d.lv}</div>`);
    lines.push(...bonusLines(itemBonus(it)).map((l) => `<div class="tt-stat">${l}</div>`));
    const opt = bonusLines(it.opt ?? {});
    if (opt.length) lines.push(`<div class="tt-opt">추가 옵션: ${opt.join(', ')}</div>`);
    if (equipped && equipped.uid !== it.uid) lines.push(`<div class="tt-cmp">착용 중: ${itemName(equipped)} — ${bonusLines(itemBonus(equipped)).join(', ')}</div>`);
  } else {
    lines.push(`<div class="tt-sub">${d.kind === 'potion' ? '소모품' : '재료'}${it.n > 1 ? ` · ${it.n}개` : ''}</div>`);
  }
  if (d.desc) lines.push(`<div class="tt-desc">${d.desc}</div>`);
  return head + lines.join('');
}

/** 화면에 하나뿐인 툴팁 */
export class Tooltip {
  private static el: HTMLDivElement | null = null;

  static show(html: string, x: number, y: number): void {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'tooltip';
      document.getElementById('ui')!.appendChild(this.el);
    }
    this.el.innerHTML = html;
    this.el.style.display = '';
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    this.el.style.left = `${Math.min(window.innerWidth - w - 8, x + 16)}px`;
    this.el.style.top = `${Math.min(window.innerHeight - h - 8, y + 12)}px`;
  }

  static hide(): void {
    if (this.el) this.el.style.display = 'none';
  }
}

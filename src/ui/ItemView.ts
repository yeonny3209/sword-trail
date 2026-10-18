import { CLASS_BY_ID } from '../../shared/data';
import {
  bonusLines, ITEMS, itemBonus, itemName, rarityColor, rarityName, SLOT_ICONS, SLOT_NAMES, socketCount, type Equip, type Item,
} from '../../shared/items';
import { perkLines } from '../../shared/perks';
import { SETS, SET_STEPS, setCounts, setOf } from '../../shared/sets';

/** 아이템 칸 그림(아이콘·등급 테두리·개수·강화) */
export function itemCell(it: Item | undefined, extra = ''): string {
  if (!it) return `<div class="cell empty ${extra}"></div>`;
  const d = ITEMS[it.id];
  const icon = d?.slot ? SLOT_ICONS[d.slot] : d?.kind === 'potion' ? (d.heal?.hp ? '🧪' : '💧') : d?.kind === 'rune' ? '💠' : d?.id === 'enh_stone' ? '💎' : '◆';
  const color = d?.kind === 'equip' ? rarityColor(it.rar) : d?.kind === 'rune' ? '#6ac8ff' : '#8a7a5a';
  const socks = socketCount(it);
  const filled = (it.sock ?? []).filter(Boolean).length;
  return `<div class="cell ${extra}" data-uid="${it.uid}" style="--rc:${color}">
    <span class="ic">${icon}</span>${it.n > 1 ? `<span class="n">${it.n}</span>` : ''}${it.enh ? `<span class="e">+${it.enh}</span>` : ''}${socks ? `<span class="so">${'◆'.repeat(filled)}${'◇'.repeat(socks - filled)}</span>` : ''}</div>`;
}

/** 툴팁 내용 */
/** 입은 장비(eq)를 알려 주면 세트 진행 상황도 보여 준다 */
export function itemTip(it: Item, equipped?: Item, eq?: Equip): string {
  const d = ITEMS[it.id];
  if (!d) return it.id;
  const head = `<div class="tt-name" style="color:${d.kind === 'equip' ? rarityColor(it.rar) : '#e8d8b0'}">${itemName(it)}</div>`;
  const lines: string[] = [];
  if (d.kind === 'equip') {
    lines.push(`<div class="tt-sub">${rarityName(it.rar)} ${SLOT_NAMES[d.slot!]}${d.cls ? ` · ${CLASS_BY_ID[d.cls].name} 전용` : ''} · 레벨 ${d.lv}</div>`);
    lines.push(...bonusLines(itemBonus(it)).map((l) => `<div class="tt-stat">${l}</div>`));
    const opt = bonusLines(it.opt ?? {});
    if (opt.length) lines.push(`<div class="tt-opt">추가 옵션: ${opt.join(', ')}</div>`);
    const n = socketCount(it);
    for (let i = 0; i < n; i++) {
      const r = it.sock?.[i];
      lines.push(r ? `<div class="tt-sock">◆ ${ITEMS[r]?.name ?? r} — ${perkLines(ITEMS[r]?.rune ?? {}).join(', ')}</div>` : '<div class="tt-sock empty">◇ 빈 룬 소켓</div>');
    }
    const sid = setOf(it.id);
    if (sid) {
      const set = SETS[sid];
      const have = eq ? setCounts(eq)[sid] ?? 0 : 0;
      lines.push(`<div class="tt-set"><b>${set.name}</b> (${have}/7 — 무기 포함 같은 단계 장비)${SET_STEPS.map((st) => `<div class="${have >= st ? 'on' : 'off'}">${st}부위: ${perkLines(set.bonus[String(st)]).join(', ')}</div>`).join('')}</div>`);
    }
    if (equipped && equipped.uid !== it.uid) lines.push(`<div class="tt-cmp">착용 중: ${itemName(equipped)} — ${bonusLines(itemBonus(equipped)).join(', ')}</div>`);
  } else {
    lines.push(`<div class="tt-sub">${d.kind === 'potion' ? '소모품' : d.kind === 'rune' ? '룬 — 대장간에서 장비 소켓에 끼움 (같은 룬 3개 → 윗단계 제작)' : '재료'}${it.n > 1 ? ` · ${it.n}개` : ''}</div>`);
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

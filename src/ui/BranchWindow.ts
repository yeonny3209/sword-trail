import { BRANCH_RULES, branchesOf } from '../../shared/branch';
import { ACTIONS, CLASS_BY_ID } from '../../shared/data';
import { perkLines } from '../../shared/perks';
import type { C2S, SelfState } from '../../shared/protocol';
import { Window } from './Window';

/** 전직 교관 창: 레벨 30에 직업마다 두 갈래 중 하나를 고른다(갈래마다 능력치·효과와 전용 스킬 둘) */
export class BranchWindow extends Window {
  me: SelfState | null = null;

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void) {
    super(ui, '전직', '', 'branch-win');
  }

  draw(): void {
    const m = this.me;
    if (!m || !this.isOpen) return;
    const cls = CLASS_BY_ID[m.cls];
    const ok = m.lv >= BRANCH_RULES.unlockLv;
    const cost = m.branch ? BRANCH_RULES.changeCost : BRANCH_RULES.cost;
    const cards = branchesOf(m.cls).map((b) => {
      const cur = m.branch === b.id;
      const skills = b.skills.map((id, i) => `<div class="sk"><b>${ACTIONS[id].name}</b> <small>${i + 5}번 키 · MP ${ACTIONS[id].mp} · 쿨타임 ${ACTIONS[id].cd}초 · 배우는 레벨 ${ACTIONS[id].lv}</small><small>${ACTIONS[id].desc ?? ''}</small></div>`).join('');
      return `<div class="branch-card ${cur ? 'cur' : ''}"><h3>${b.name}${cur ? ' ✔' : ''}</h3><div class="desc">${b.desc}</div>
        <div class="perk">${perkLines(b.perks).join('<br>')}</div>${skills}
        <div class="row end" style="margin-top:8px"><button class="btn primary pick" data-id="${b.id}" ${!ok || cur || m.gold < cost ? 'disabled' : ''}>${cur ? '선택됨' : m.branch ? '이 갈래로 바꾸기' : '이 갈래로 전직'}</button></div></div>`;
    }).join('');
    this.body.innerHTML = `<div class="hint">${cls.name} — 레벨 ${BRANCH_RULES.unlockLv}부터 전직할 수 있습니다. 비용 <b>${cost.toLocaleString()} G</b>${m.branch ? ' (갈래를 바꾸는 비용)' : ` · 처음 전직하면 스킬 포인트 +${BRANCH_RULES.grantPoints}`}${ok ? '' : ` <span style="color:#ff8070">(현재 Lv ${m.lv})</span>`}</div>
      <div class="branch-cards">${cards}</div>`;
    this.body.querySelectorAll<HTMLButtonElement>('.pick').forEach((b) => b.addEventListener('click', () => {
      const name = branchesOf(m.cls).find((x) => x.id === b.dataset.id)?.name;
      if (confirm(`${name}(으)로 ${m.branch ? '바꿀' : '전직할'}까요? ${cost.toLocaleString()} G가 듭니다.`)) this.send({ t: 'branch', id: b.dataset.id! });
    }));
  }
}

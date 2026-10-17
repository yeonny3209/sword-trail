import { MONSTERS, ZONES } from '../../shared/data';
import { ITEMS } from '../../shared/items';
import { availableQuests, isComplete, progressOf, QUESTS, type QuestDef, type QuestState } from '../../shared/quests';
import type { C2S } from '../../shared/protocol';
import { Window } from './Window';

function objText(q: QuestDef, p: number[]): string {
  return q.obj.map((o, i) => {
    const what = o.type === 'kill' ? `${MONSTERS[o.target]?.name ?? o.target} 처치`
      : o.type === 'collect' ? `${ITEMS[o.target]?.name ?? o.target} 모으기`
      : `${ZONES[o.target]?.name ?? o.target} 가 보기`;
    const done = p[i] >= o.n;
    return `<div class="obj ${done ? 'done' : ''}">${done ? '✔' : '·'} ${what} ${o.type === 'visit' ? '' : `${p[i]}/${o.n}`}</div>`;
  }).join('');
}

function rewardText(q: QuestDef): string {
  const r = q.reward;
  const parts = [r.exp ? `경험치 ${r.exp.toLocaleString()}` : '', r.gold ? `${r.gold.toLocaleString()} G` : '',
    ...(r.items ?? []).map(([id, n]) => `${ITEMS[id]?.name ?? id} ${n}개`), r.equip ? `Lv${r.equip.lv} 장비(등급 보장)` : ''];
  return parts.filter(Boolean).join(' · ');
}

/** 퀘스트 상태 보관 + 목록 창(L) + 화면 오른쪽 추적기 + NPC 대화 */
export class QuestUi {
  qs: QuestState = { active: {}, done: [] };
  lv = 1;
  count: (id: string) => number = () => 0;
  readonly win: Window;
  readonly dialog: Window;
  private readonly tracker: HTMLDivElement;
  private giver = '';

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void) {
    this.win = new Window(ui, '퀘스트', 'L', 'quest-win');
    this.win.draw = () => this.drawLog();
    this.dialog = new Window(ui, '대화', '', 'quest-dialog');
    this.dialog.draw = () => this.drawDialog();
    this.tracker = document.createElement('div');
    this.tracker.className = 'quest-tracker';
    ui.appendChild(this.tracker);
  }

  set(qs: QuestState): void {
    this.qs = qs;
    this.refresh();
  }

  /** 퀘스트 상태가 바뀌면(NPC 머리 위 표시 갱신 등) */
  onChange: () => void = () => {};

  refresh(): void {
    this.onChange();
    this.win.draw();
    this.dialog.draw();
    this.drawTracker();
  }

  /** NPC 머리 위 표시: ? 완료 가능, ! 받을 수 있음 */
  markerFor(npcId: string): string {
    const ready = Object.keys(this.qs.active).some((id) => QUESTS[id]?.giver === npcId && isComplete(QUESTS[id], this.qs, this.count));
    if (ready) return '<span class="qmark ready">?</span>';
    return availableQuests(this.qs, npcId, this.lv).length ? '<span class="qmark">!</span>' : '';
  }

  openGiver(npcId: string, npcName: string): void {
    this.giver = npcId;
    this.dialog.el.querySelector('.win-head span')!.textContent = npcName;
    this.dialog.open();
  }

  private drawTracker(): void {
    const ids = Object.keys(this.qs.active);
    this.tracker.innerHTML = ids.length ? `<div class="th">퀘스트 <small>L</small></div>${ids.map((id) => {
      const q = QUESTS[id];
      if (!q) return '';
      const p = progressOf(q, this.qs, this.count);
      const done = isComplete(q, this.qs, this.count);
      return `<div class="tq ${done ? 'done' : ''}"><b>${q.name}</b>${done ? ' <small>완료 — 돌아가서 보고</small>' : objText(q, p)}</div>`;
    }).join('')}` : '';
  }

  private drawLog(): void {
    if (!this.win.isOpen) return;
    const ids = Object.keys(this.qs.active);
    this.win.body.innerHTML = (ids.length ? ids.map((id) => {
      const q = QUESTS[id];
      const p = progressOf(q, this.qs, this.count);
      return `<div class="qrow"><div class="qn">${q.name} <small>Lv${q.lv}</small></div><div class="qd">${q.desc}</div>${objText(q, p)}
        <div class="qr">보상: ${rewardText(q)}</div><div class="row end"><button class="btn small ab" data-id="${id}">포기</button></div></div>`;
    }).join('') : '<div class="hint">진행 중인 퀘스트가 없습니다. 마을의 <b>촌장 오윤</b>과 <b>경비대장 루크</b>에게 말을 걸어 보세요.</div>')
      + `<div class="hint">완료한 퀘스트 ${this.qs.done.length}개</div>`;
    this.win.body.querySelectorAll<HTMLButtonElement>('.ab').forEach((b) => b.addEventListener('click', () => {
      if (confirm('이 퀘스트를 포기할까요? 진행이 사라집니다.')) this.send({ t: 'qabandon', id: b.dataset.id! });
    }));
  }

  private drawDialog(): void {
    if (!this.dialog.isOpen) return;
    const mine = Object.keys(this.qs.active).map((id) => QUESTS[id]).filter((q) => q?.giver === this.giver);
    const avail = availableQuests(this.qs, this.giver, this.lv);
    const later = Object.values(QUESTS).filter((q) => q.giver === this.giver && !this.qs.done.includes(q.id) && !(q.id in this.qs.active)
      && (!q.req || this.qs.done.includes(q.req)) && q.lv > this.lv);
    const block = (q: QuestDef, btn: string) => `<div class="qrow"><div class="qn">${q.name} <small>Lv${q.lv}</small></div>
      <div class="qd">${q.desc}</div>${objText(q, progressOf(q, this.qs, this.count))}<div class="qr">보상: ${rewardText(q)}</div>${btn}</div>`;
    this.dialog.body.innerHTML = [
      ...mine.map((q) => block(q, isComplete(q, this.qs, this.count)
        ? `<div class="row end"><button class="btn primary small turn" data-id="${q.id}">완료 보고</button></div>`
        : '<div class="hint">아직 진행 중입니다.</div>')),
      ...avail.map((q) => block(q, `<div class="row end"><button class="btn primary small acc" data-id="${q.id}">수락</button></div>`)),
      ...later.slice(0, 1).map((q) => `<div class="hint">다음 이야기: 레벨 ${q.lv}이 되면 다시 찾아오게.</div>`),
    ].join('') || '<div class="hint">지금은 부탁할 일이 없다네.</div>';
    this.dialog.body.querySelectorAll<HTMLButtonElement>('.acc').forEach((b) => b.addEventListener('click', () => this.send({ t: 'qaccept', id: b.dataset.id! })));
    this.dialog.body.querySelectorAll<HTMLButtonElement>('.turn').forEach((b) => b.addEventListener('click', () => this.send({ t: 'qturnin', id: b.dataset.id! })));
  }
}

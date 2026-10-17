import { ACTIONS, CLASS_BY_ID, KITS } from '../../shared/data';
import type { C2S, SelfState } from '../../shared/protocol';
import { expToNext, skillMax, skillMp, skillMul, STAT_DESC, STAT_KEYS, STAT_NAMES } from '../../shared/rules';
import { Window } from './Window';

const KEYS = ['Q', 'E', 'T', 'F', 'G', 'R', '1', '2', '3', '4'];

/** 캐릭터 정보(U): 능력치와 스탯 포인트 분배 */
export class CharacterWindow extends Window {
  me: SelfState | null = null;

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void) {
    super(ui, '캐릭터 정보', 'U', 'char-win');
  }

  draw(): void {
    const m = this.me;
    if (!m || !this.isOpen) return;
    const cls = CLASS_BY_ID[m.cls];
    const rows = STAT_KEYS.map((k) => `<div class="stat-row" title="${STAT_DESC[k]}">
      <span class="k">${STAT_NAMES[k]}${k === cls.mainStat ? ' <small>주 스탯</small>' : ''}</span><b>${m.alloc[k]}</b>
      <button class="btn small plus" data-s="${k}" ${m.statPoints < 1 ? 'disabled' : ''}>+</button></div>`).join('');
    this.body.innerHTML = `
      <div class="char-head" style="--c:${cls.color}"><b>${m.name}</b> <span>Lv ${m.lv} ${cls.name}</span></div>
      <div class="kv"><span>경험치</span><b>${m.exp} / ${expToNext(m.lv)}</b></div>
      <div class="kv"><span>골드</span><b>${m.gold.toLocaleString()} G</b></div>
      <hr>
      <div class="grid2">
        <div class="kv"><span>공격력</span><b>${m.atk}</b></div><div class="kv"><span>방어력</span><b>${m.def}</b></div>
        <div class="kv"><span>최대 HP</span><b>${m.mhp}</b></div><div class="kv"><span>최대 MP</span><b>${m.mmp}</b></div>
        <div class="kv"><span>치명타</span><b>${(m.crit * 100).toFixed(1)}%</b></div><div class="kv"><span>이동 속도</span><b>${m.speed.toFixed(1)}</b></div>
      </div>
      <hr>
      <div class="pts">스탯 포인트 <b>${m.statPoints}</b></div>
      ${rows}
      <div class="row end"><button class="btn small reset">스탯·스킬 초기화</button></div>`;
    this.body.querySelectorAll<HTMLButtonElement>('.plus').forEach((b) =>
      b.addEventListener('click', () => this.send({ t: 'stat', s: b.dataset.s as 'str' })));
    this.body.querySelector('.reset')!.addEventListener('click', () => {
      if (confirm('스탯과 스킬 포인트를 모두 돌려받을까요?')) this.send({ t: 'reset' });
    });
  }
}

/** 스킬(K): 배우기·레벨 올리기 */
export class SkillWindow extends Window {
  me: SelfState | null = null;

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void) {
    super(ui, '스킬', 'K', 'skill-win');
  }

  draw(): void {
    const m = this.me;
    if (!m || !this.isOpen) return;
    const kit = KITS[m.cls];
    const rows = kit.skills.map((id, i) => {
      const d = ACTIONS[id];
      const lv = m.skills[id] ?? 0;
      const max = skillMax(d);
      const need = d.lv ?? 1;
      const can = m.skillPoints > 0 && lv < max && m.lv >= need;
      const effect = lv > 0 ? `피해 ${Math.round(skillMul(lv) * 100)}% · MP ${skillMp(d, lv)}` : `MP ${d.mp ?? 0}`;
      return `<div class="skill-row ${lv ? '' : 'unlearned'} ${m.lv < need ? 'locked' : ''}">
        <div class="key">${KEYS[i]}</div>
        <div class="info"><div class="nm">${d.name} <small>Lv ${lv}/${max}</small>${i === 5 ? ' <span class="ult">궁극기</span>' : ''}</div>
          <div class="desc">${d.desc ?? ''}</div>
          <div class="meta">배우는 레벨 ${need} · 쿨타임 ${d.cd ?? 0}초 · ${effect}</div></div>
        <button class="btn small up" data-a="${id}" ${can ? '' : 'disabled'}>${lv ? '레벨 업' : '배우기'}</button></div>`;
    }).join('');
    this.body.innerHTML = `<div class="pts">스킬 포인트 <b>${m.skillPoints}</b> <small>레벨마다 1점</small></div>${rows}`;
    this.body.querySelectorAll<HTMLButtonElement>('.up').forEach((b) =>
      b.addEventListener('click', () => this.send({ t: 'skill', a: b.dataset.a! })));
  }
}

export { Window };

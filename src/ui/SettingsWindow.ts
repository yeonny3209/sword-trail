import { bus } from '../core/bus';
import type { Settings } from '../core/events';
import { settings } from '../core/Settings';
import { Window } from './Window';

type Row =
  | { k: keyof Settings; label: string; kind: 'toggle'; hint?: string }
  | { k: keyof Settings; label: string; kind: 'range'; min: number; max: number; step: number; fmt: (v: number) => string; hint?: string };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const auto = (v: number) => (v <= 0 ? '끔' : `${Math.round(v * 100)}% 아래`);

const ROWS: { title: string; rows: Row[] }[] = [
  { title: '소리', rows: [
    { k: 'volume', label: '효과음', kind: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { k: 'music', label: '배경음악', kind: 'range', min: 0, max: 1, step: 0.05, fmt: pct, hint: 'M 키로 바로 끄고 켬' },
  ] },
  { title: '화면', rows: [
    { k: 'shake', label: '화면 흔들림', kind: 'range', min: 0, max: 1.5, step: 0.05, fmt: pct },
    { k: 'bloom', label: '빛 번짐(고급 효과)', kind: 'toggle', hint: 'F4 — 느린 컴퓨터에서 끄면 빨라짐' },
    { k: 'damageNumbers', label: '피해 숫자', kind: 'toggle' },
    { k: 'showNames', label: '플레이어·NPC 이름', kind: 'toggle' },
  ] },
  { title: '전투 도우미', rows: [
    { k: 'autoHp', label: '자동 HP 물약', kind: 'range', min: 0, max: 0.8, step: 0.05, fmt: auto, hint: '체력이 이만큼 아래로 떨어지면 C 물약을 마십니다' },
    { k: 'autoMp', label: '자동 MP 물약', kind: 'range', min: 0, max: 0.8, step: 0.05, fmt: auto },
    { k: 'aimAssist', label: '조준 보조', kind: 'toggle', hint: '마우스 방향 근처의 적 쪽으로 공격이 살짝 돌아갑니다' },
    { k: 'cdAlert', label: '스킬 준비 알림', kind: 'toggle', hint: '쿨타임이 끝난 스킬 칸이 반짝' },
  ] },
];

/** 설정 창(F10 또는 창이 없을 때 Esc): 소리·화면·전투 도우미. 바로 적용되고 이 브라우저에 저장 */
export class SettingsWindow extends Window {
  constructor(ui: HTMLElement) {
    super(ui, '설정', 'F10', 'settings-win');
  }

  draw(): void {
    if (!this.isOpen) return;
    const v = settings.v;
    this.body.innerHTML = ROWS.map((g) => `<div class="set-group"><div class="set-title">${g.title}</div>${g.rows.map((r) => {
      const hint = r.hint ? `<div class="set-hint">${r.hint}</div>` : '';
      if (r.kind === 'toggle') return `<label class="set-row"><span>${r.label}</span><input type="checkbox" data-k="${r.k}" ${v[r.k] ? 'checked' : ''}></label>${hint}`;
      const val = v[r.k] as number;
      return `<div class="set-row"><span>${r.label}</span><input type="range" data-k="${r.k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${val}"><b data-v="${r.k}">${r.fmt(val)}</b></div>${hint}`;
    }).join('')}</div>`).join('') + '<div class="set-foot"><button class="btn" data-reset>기본값으로</button> <button class="btn" data-help>조작법 보기 (F1)</button></div>';
    this.body.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((inp) => {
      const k = inp.dataset.k as keyof Settings;
      const row = ROWS.flatMap((g) => g.rows).find((r) => r.k === k)!;
      inp.addEventListener('input', () => {
        if (inp.type === 'checkbox') settings.set(k, inp.checked as never);
        else {
          const n = Number(inp.value);
          settings.set(k, n as never);
          const out = this.body.querySelector(`[data-v="${k}"]`);
          if (out && row.kind === 'range') out.textContent = row.fmt(n);
        }
      });
    });
    this.body.querySelector('[data-reset]')!.addEventListener('click', () => {
      settings.reset();
      this.draw();
    });
    this.body.querySelector('[data-help]')!.addEventListener('click', () => bus.emit('help', {}));
  }
}

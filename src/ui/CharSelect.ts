import { baseZone, CLASSES, CLASS_BY_ID, ZONES } from '../../shared/data';
import type { CharacterSummary } from '../../shared/protocol';
import type { ClassId } from '../../shared/types';
import { ApiError, createCharacter, deleteCharacter, listCharacters, logout, savedAccount } from '../net/api';

/** 캐릭터 선택·생성 화면 */
export class CharSelect {
  readonly el: HTMLDivElement;
  private chars: CharacterSummary[] = [];
  private picked: ClassId = 'swordsman';

  constructor(parent: HTMLElement, private readonly onEnter: (id: number) => void, private readonly onLogout: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'screen charselect';
    parent.appendChild(this.el);
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.chars = await listCharacters();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        this.hide();
        this.onLogout();
        return;
      }
      this.chars = [];
    }
    this.draw();
  }

  private draw(): void {
    const cards = this.chars.map((c) => {
      const cls = CLASS_BY_ID[c.cls];
      return `<div class="char-card" data-id="${c.id}" style="--c:${cls.color}">
        <div class="cname">${c.name}</div>
        <div class="cmeta">Lv ${c.lv} · ${cls.name}</div>
        <div class="czone">${ZONES[baseZone(c.zone)]?.name ?? ''}</div>
        <div class="row"><button class="btn primary enter">접속</button><button class="btn small del">삭제</button></div>
      </div>`;
    }).join('');
    const classes = CLASSES.map((c) => `<div class="class-card ${c.id === this.picked ? 'on' : ''}" data-cls="${c.id}" style="--c:${c.color}">
        <div class="n">${c.name}</div><div class="r">${c.role}</div><div class="d">${c.desc}</div>
        <div class="st">체력 ${c.base.hp} · 마나 ${c.base.mp} · 공격 ${c.base.atk}</div></div>`).join('');
    this.el.innerHTML = `
      <div class="topbar"><span>${savedAccount()} 님</span><button class="btn small logout">로그아웃</button></div>
      <h2>캐릭터 선택</h2>
      <div class="char-list">${cards || '<p class="sub">아직 캐릭터가 없습니다. 아래에서 만들어 주세요.</p>'}</div>
      ${this.chars.length < 4 ? `
      <div class="panel create">
        <h3>새 캐릭터</h3>
        <div class="class-list">${classes}</div>
        <div class="row"><input class="nm" maxlength="12" placeholder="캐릭터 이름 (2~12자)"><button class="btn primary make">만들기</button></div>
        <div class="err"></div>
      </div>` : ''}`;
    this.el.querySelector('.logout')!.addEventListener('click', () => {
      logout();
      this.hide();
      this.onLogout();
    });
    for (const card of this.el.querySelectorAll<HTMLDivElement>('.char-card')) {
      const id = Number(card.dataset.id);
      card.querySelector('.enter')!.addEventListener('click', () => this.enter(id));
      card.addEventListener('dblclick', () => this.enter(id));
      card.querySelector('.del')!.addEventListener('click', async () => {
        const c = this.chars.find((x) => x.id === id);
        if (!c || !confirm(`${c.name}을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
        await deleteCharacter(id).catch(() => undefined);
        void this.refresh();
      });
    }
    for (const card of this.el.querySelectorAll<HTMLDivElement>('.class-card')) {
      card.addEventListener('click', () => {
        this.picked = card.dataset.cls as ClassId;
        this.el.querySelectorAll('.class-card').forEach((c) => c.classList.toggle('on', c === card));
      });
    }
    const make = this.el.querySelector<HTMLButtonElement>('.make');
    const nameInput = this.el.querySelector<HTMLInputElement>('.nm');
    const err = this.el.querySelector<HTMLDivElement>('.create .err');
    const submit = async () => {
      if (!nameInput || !err) return;
      err.textContent = '';
      try {
        const { id } = await createCharacter(nameInput.value.trim(), this.picked);
        this.enter(id);
      } catch (e) {
        err.textContent = (e as Error).message;
      }
    };
    make?.addEventListener('click', submit);
    nameInput?.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  }

  private enter(id: number): void {
    this.hide();
    this.onEnter(id);
  }

  hide(): void {
    this.el.remove();
  }
}

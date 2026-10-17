import { bus } from '../core/bus';
import { CLASS_BY_ID, ZONES } from '../../shared/data';
import type { C2S } from '../../shared/protocol';
import { GUILD_COST, GUILD_MIN_LV, MAX_PARTY, type C2Social, type GuildInfo, type PartyMember } from '../../shared/social';
import { Window } from './Window';

const RANK = ['길드원', '부길드장', '길드장'];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** 파티 프레임(왼쪽), 파티 창(P), 길드 창(N), 초대 팝업, 다른 플레이어 메뉴 */
export class SocialUi {
  myId = 0;
  party: { leader: number; members: PartyMember[] } | null = null;
  guild: GuildInfo | null = null;
  online = 0;
  /** 같은 존 파티원의 체력 비율(보이지 않으면 null) */
  hpOf: (id: number) => number | null = () => null;
  readonly partyWin: Window;
  readonly guildWin: Window;
  private readonly frame: HTMLDivElement;
  private readonly popups: HTMLDivElement;

  constructor(ui: HTMLElement, private readonly send: (m: C2Social) => void, private readonly sendZone: (m: C2S) => void) {
    this.frame = document.createElement('div');
    this.frame.className = 'party-frame';
    this.popups = document.createElement('div');
    this.popups.className = 'popups';
    ui.append(this.frame, this.popups);
    this.partyWin = new Window(ui, '파티', 'P', 'party-win');
    this.partyWin.draw = () => this.drawPartyWin();
    this.guildWin = new Window(ui, '길드', 'N', 'guild-win');
    this.guildWin.draw = () => this.drawGuild();
    bus.on('social', (m) => {
      switch (m.t) {
        case 'party':
          this.party = { leader: m.leader, members: m.members };
          return this.drawParty();
        case 'noparty':
          this.party = null;
          return this.drawParty();
        case 'guild':
          this.guild = m.g;
          return this.guildWin.draw();
        case 'noguild':
          this.guild = null;
          return this.guildWin.draw();
        case 'online':
          this.online = m.n;
          return;
        case 'pinvite':
          return this.popup(`<b>${esc(m.name)}</b>님이 파티에 초대했습니다.`, (ok) => this.send({ t: 'preply', from: m.from, ok }));
        case 'ginvite':
          return this.popup(`<b>${esc(m.from)}</b>님이 길드 <b>&lt;${esc(m.gname)}&gt;</b>에 초대했습니다.`, (ok) => this.send({ t: 'greply', gid: m.gid, ok }));
      }
    });
  }

  /** 수락·거절 팝업(30초 뒤 자동 거절) */
  private popup(html: string, answer: (ok: boolean) => void): void {
    const el = document.createElement('div');
    el.className = 'invite';
    el.innerHTML = `<div>${html}</div><div class="row"><button class="btn small yes">수락</button><button class="btn small no">거절</button><span class="left"></span></div>`;
    this.popups.appendChild(el);
    bus.emit('sfx', { key: 'ui' });
    let done = false, left = 30;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      answer(ok);
      el.remove();
    };
    const timer = setInterval(() => {
      left--;
      (el.querySelector('.left') as HTMLElement).textContent = `${left}초`;
      if (left <= 0) finish(false);
    }, 1000);
    el.querySelector('.yes')!.addEventListener('click', () => finish(true));
    el.querySelector('.no')!.addEventListener('click', () => finish(false));
  }

  invite(name: string): void {
    if (name) this.send({ t: 'pinvite', name });
  }

  // ───────── 파티 ─────────
  private drawParty(): void {
    const p = this.party;
    this.frame.innerHTML = p
      ? `<div class="ph">파티 <small>${p.members.length}/${MAX_PARTY}</small></div>` +
        p.members.map((m) => `<div class="pm" data-id="${m.id}" style="--c:${CLASS_BY_ID[m.cls].color}">
          <div class="pn">${m.id === p.leader ? '<span class="crown">♛</span>' : ''}<b>${esc(m.name)}</b> <small>Lv${m.lv} ${CLASS_BY_ID[m.cls].name}</small></div>
          <div class="php"><div></div></div><div class="pz">${ZONES[m.zone]?.name ?? ''}</div></div>`).join('')
      : '';
    this.updateParty();
    this.partyWin.draw();
  }

  /** 파티 프레임 체력 막대만 갱신(같은 존이면 막대, 아니면 있는 곳) */
  updateParty(): void {
    this.frame.querySelectorAll<HTMLDivElement>('.pm').forEach((el) => {
      const hp = this.hpOf(Number(el.dataset.id));
      el.classList.toggle('far', hp === null);
      if (hp !== null) (el.querySelector('.php div') as HTMLDivElement).style.width = `${Math.max(0, Math.min(1, hp)) * 100}%`;
    });
  }

  private drawPartyWin(): void {
    if (!this.partyWin.isOpen) return;
    const p = this.party;
    const leader = !p || p.leader === this.myId;
    const b = this.partyWin.body;
    b.innerHTML = `
      ${leader ? `<div class="row"><input class="pinv" maxlength="12" placeholder="초대할 캐릭터 이름"><button class="btn small invite">초대</button></div>` : ''}
      ${p ? `<div class="gm-list">${p.members.map((m) => `<div class="gm on"><span class="dot"></span>${m.id === p.leader ? '♛ ' : ''}<b>${esc(m.name)}</b>
        <small>Lv${m.lv} ${CLASS_BY_ID[m.cls].name} · ${ZONES[m.zone]?.name ?? ''}</small>
        ${leader && m.id !== this.myId ? `<button class="kick" data-id="${m.id}" title="추방">✕</button>` : ''}</div>`).join('')}</div>
        <div class="row end"><button class="btn small pleave">파티 나가기</button></div>`
        : '<div class="hint">파티에 들어가 있지 않습니다.</div>'}
      <div class="hint">최대 ${MAX_PARTY}명. 같은 지역에서 가까이 있는 파티원과 경험치를 나누고(인원당 +20% 보너스), 처치 퀘스트도 함께 진행됩니다.<br>
      다른 플레이어를 <b>오른쪽 클릭</b>하거나 채팅에 <b>/초대 이름</b>. 파티 채팅은 <b>/파티 내용</b>.</div>`;
    const input = b.querySelector<HTMLInputElement>('.pinv');
    const go = () => {
      this.invite(input!.value.trim());
      input!.value = '';
    };
    b.querySelector('.invite')?.addEventListener('click', go);
    input?.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    b.querySelectorAll<HTMLButtonElement>('.kick').forEach((k) => k.addEventListener('click', () => this.send({ t: 'pkick', id: Number(k.dataset.id) })));
    b.querySelector('.pleave')?.addEventListener('click', () => this.send({ t: 'pleave' }));
  }

  // ───────── 길드 ─────────
  private drawGuild(): void {
    if (!this.guildWin.isOpen) return;
    const g = this.guild;
    const b = this.guildWin.body;
    if (!g) {
      b.innerHTML = `<div class="hint">길드에 들어가 있지 않습니다. 길드원의 초대를 받거나 직접 만들 수 있습니다.</div>
        <div class="gcreate"><div class="sub">길드 창설 — 마을의 <b>길드 관리인 하론</b> 앞에서 · 레벨 ${GUILD_MIN_LV} 이상 · ${GUILD_COST.toLocaleString()} G</div>
        <div class="row"><input class="gnm" maxlength="10" placeholder="길드 이름(한글·영문·숫자 2~10자)"><button class="btn small mk">창설</button></div></div>`;
      b.querySelector('.mk')!.addEventListener('click', () => {
        const name = (b.querySelector('.gnm') as HTMLInputElement).value.trim();
        if (name) this.sendZone({ t: 'gcreate', name });
      });
      return;
    }
    const rank = g.members.find((m) => m.id === this.myId)?.rank ?? 0;
    const on = g.members.filter((m) => m.online).length;
    const members = [...g.members].sort((x, y) => Number(y.online) - Number(x.online) || y.rank - x.rank || y.lv - x.lv);
    b.innerHTML = `
      <div class="gname">&lt;${esc(g.name)}&gt; <small>${g.members.length}명 · 접속 ${on}명 · 내 직위 ${RANK[rank]}</small></div>
      <div class="gnotice">${g.notice ? esc(g.notice) : '<span class="hint">공지가 없습니다.</span>'}</div>
      ${rank >= 1 ? `<div class="row"><input class="ginv" maxlength="12" placeholder="초대할 캐릭터 이름"><button class="btn small invite">초대</button></div>
        <div class="row"><input class="gnote" maxlength="120" placeholder="공지 바꾸기"><button class="btn small note">공지</button></div>` : ''}
      <div class="gm-list">${members.map((m) => `<div class="gm ${m.online ? 'on' : ''}">
        <span class="dot"></span><b>${esc(m.name)}</b> <small>Lv${m.lv} ${CLASS_BY_ID[m.cls].name} · ${RANK[m.rank]}${m.online ? ` · ${ZONES[m.zone]?.name ?? ''}` : ''}</small>
        ${rank >= 1 && m.rank < rank ? `<button class="kick" data-id="${m.id}" title="추방">✕</button>` : ''}</div>`).join('')}</div>
      <div class="row end"><button class="btn small gleave">${rank === 2 && g.members.length === 1 ? '길드 해산' : '탈퇴'}</button></div>
      <div class="hint">길드 채팅은 <b>/길드 내용</b></div>`;
    b.querySelector('.invite')?.addEventListener('click', () => {
      const name = (b.querySelector('.ginv') as HTMLInputElement).value.trim();
      if (name) this.send({ t: 'ginvite', name });
    });
    b.querySelector('.note')?.addEventListener('click', () => {
      const text = (b.querySelector('.gnote') as HTMLInputElement).value.trim();
      if (text) this.send({ t: 'gnotice', text });
    });
    b.querySelectorAll<HTMLButtonElement>('.kick').forEach((k) => k.addEventListener('click', () => {
      if (confirm('이 길드원을 추방할까요?')) this.send({ t: 'gkick', id: Number(k.dataset.id) });
    }));
    b.querySelector('.gleave')!.addEventListener('click', () => {
      if (confirm(rank === 2 && g.members.length === 1 ? '길드를 해산할까요?' : '정말 길드를 떠날까요?')) this.send({ t: 'gleave' });
    });
  }

  /** 다른 플레이어를 오른쪽 클릭했을 때 메뉴 */
  playerMenu(name: string, x: number, y: number, extra: [string, () => void][] = []): void {
    document.querySelector('.ctx')?.remove();
    const acts: [string, () => void][] = [
      ['귓속말', () => bus.emit('chatPrefill', { text: `/w ${name} ` })],
      ['파티 초대', () => this.invite(name)],
      ...extra,
    ];
    if (this.guild) acts.push(['길드 초대', () => this.send({ t: 'ginvite', name })]);
    const m = document.createElement('div');
    m.className = 'ctx';
    m.innerHTML = `<div class="ctx-title">${esc(name)}</div>` + acts.map(([n], i) => `<button data-i="${i}">${n}</button>`).join('');
    m.style.left = `${x + 4}px`;
    m.style.top = `${y + 4}px`;
    document.body.appendChild(m);
    const close = () => {
      m.remove();
      window.removeEventListener('mousedown', away, true);
    };
    const away = (e: MouseEvent) => !m.contains(e.target as Node) && close();
    m.querySelectorAll<HTMLButtonElement>('button').forEach((bt) => bt.addEventListener('click', () => {
      acts[Number(bt.dataset.i)][1]();
      close();
    }));
    setTimeout(() => window.addEventListener('mousedown', away, true), 0);
  }
}

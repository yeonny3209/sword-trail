import { bus } from '../core/bus';
import type { ChatChannel } from '../../shared/protocol';

const CH_NAME: Record<ChatChannel, string> = { zone: '지역', world: '전체', whisper: '귓속말', party: '파티', guild: '길드', system: '알림' };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * 채팅창: Enter로 입력 시작·전송, Esc로 취소. 입력 중에는 게임 키를 막는다.
 * 보낼 때는 onSend(채널, 내용, 대상)를 부른다.
 */
export class ChatBox {
  private readonly el: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private active = false;
  /** 마지막으로 귓속말을 보낸 사람(/r 로 답장) */
  private lastWhisper = '';
  /** 보낸 말 기록(↑↓) */
  private history: string[] = [];
  private hi = 0;
  /** 채널 말고 다른 명령(/초대 등). 처리했으면 true */
  onCommand: (cmd: string, arg: string) => boolean = () => false;

  constructor(ui: HTMLElement, private readonly onSend: (ch: ChatChannel, text: string, to?: string) => void) {
    this.el = document.createElement('div');
    this.el.className = 'chat';
    this.el.innerHTML = `<div class="log"></div><input class="in" maxlength="120" placeholder="Enter: 채팅  ·  /전체 /파티 /길드 /w 이름">`;
    ui.appendChild(this.el);
    this.log = this.el.querySelector('.log')!;
    this.input = this.el.querySelector('.in')!;
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      if (document.activeElement === this.input) {
        this.send();
        this.close();
      } else if (!(document.activeElement instanceof HTMLInputElement)) {
        e.preventDefault();
        this.open();
      }
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      // ↑↓: 지난번에 보낸 말 다시 쓰기
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.history.length) {
        e.preventDefault();
        this.hi = Math.max(0, Math.min(this.history.length, this.hi + (e.key === 'ArrowUp' ? -1 : 1)));
        this.input.value = this.history[this.hi] ?? '';
      }
    });
    this.input.addEventListener('blur', () => this.active && this.close());
    bus.on('chatPrefill', ({ text }) => {
      this.open();
      this.input.value = text;
    });
    bus.on('net', (m) => {
      if (m.t === 'chat') this.add(m.ch, m.from, m.text);
      else if (m.t === 'sys') this.add('system', '', m.text);
      else if (m.t === 'err') this.add('system', '', m.text);
    });
  }

  private open(): void {
    this.active = true;
    this.el.classList.add('typing');
    this.input.focus();
    bus.emit('typing', { active: true });
  }

  private close(): void {
    this.active = false;
    this.el.classList.remove('typing');
    this.input.value = '';
    this.input.blur();
    bus.emit('typing', { active: false });
  }

  /** "/전체 안녕" 같은 접두어로 채널을 고른다 */
  private send(): void {
    let text = this.input.value.trim();
    if (!text) return;
    if (this.history[this.history.length - 1] !== text) this.history.push(text);
    if (this.history.length > 30) this.history.shift();
    this.hi = this.history.length;
    let ch: ChatChannel = 'zone';
    let to: string | undefined;
    const m = text.match(/^\/(\S+)\s*(.*)$/);
    if (m) {
      const cmd = m[1].toLowerCase();
      if (cmd === '전체' || cmd === 'all' || cmd === 'world' || cmd === 'a') ch = 'world';
      else if (cmd === '파티' || cmd === 'p') ch = 'party';
      else if (cmd === '길드' || cmd === 'g') ch = 'guild';
      else if (cmd === 'r' || cmd === '답장') {
        if (!this.lastWhisper || !m[2]) return this.add('system', '', '답장할 귓속말이 없습니다.');
        return this.onSend('whisper', m[2], this.lastWhisper);
      } else if (cmd === '도움' || cmd === 'help' || cmd === '?') {
        return this.add('system', '', '채팅: /전체 /파티 /길드 /w 이름 /r(답장) · 파티: /초대 이름, /파티나가기 · 길드: /길드초대 이름 · 창: P 파티, N 길드');
      } else if (cmd === 'w' || cmd === '귓' || cmd === '귓속말') {
        const parts = m[2].split(/\s+/);
        ch = 'whisper';
        to = parts.shift();
        text = parts.join(' ');
        if (!to || !text) return this.add('system', '', '사용법: /w 이름 내용');
        return this.onSend(ch, text, to);
      }
      else if (this.onCommand(cmd, m[2])) return;
      else return this.add('system', '', `모르는 명령입니다: /${m[1]} (도움말: /도움)`);
      text = m[2];
      if (!text) return;
    }
    this.onSend(ch, text, to);
  }

  /** 시스템 알림(HTML 허용 — 게임 코드가 만든 문자열만) */
  addHtml(html: string): void {
    const line = document.createElement('div');
    line.className = 'ln ch-system';
    line.innerHTML = html;
    this.log.appendChild(line);
    while (this.log.children.length > 60) this.log.firstChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  add(ch: ChatChannel, from: string, text: string): void {
    if (ch === 'whisper' && !from.startsWith('→')) this.lastWhisper = from;
    const line = document.createElement('div');
    line.className = `ln ch-${ch}`;
    line.innerHTML = ch === 'system' ? esc(text) : `<span class="tag">[${CH_NAME[ch]}]</span> <b>${esc(from)}</b>: ${esc(text)}`;
    this.log.appendChild(line);
    while (this.log.children.length > 60) this.log.firstChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}

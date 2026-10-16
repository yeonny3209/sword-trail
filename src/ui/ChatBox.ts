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
    });
    this.input.addEventListener('blur', () => this.active && this.close());
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
    let ch: ChatChannel = 'zone';
    let to: string | undefined;
    const m = text.match(/^\/(\S+)\s*(.*)$/);
    if (m) {
      const cmd = m[1].toLowerCase();
      if (cmd === '전체' || cmd === 'all' || cmd === 'world') ch = 'world';
      else if (cmd === '파티' || cmd === 'p') ch = 'party';
      else if (cmd === '길드' || cmd === 'g') ch = 'guild';
      else if (cmd === 'w' || cmd === '귓' || cmd === '귓속말') {
        const parts = m[2].split(/\s+/);
        ch = 'whisper';
        to = parts.shift();
        text = parts.join(' ');
        if (!to || !text) return this.add('system', '', '사용법: /w 이름 내용');
        return this.onSend(ch, text, to);
      }
      text = m[2];
      if (!text) return;
    }
    this.onSend(ch, text, to);
  }

  add(ch: ChatChannel, from: string, text: string): void {
    const line = document.createElement('div');
    line.className = `ln ch-${ch}`;
    line.innerHTML = ch === 'system' ? esc(text) : `<span class="tag">[${CH_NAME[ch]}]</span> <b>${esc(from)}</b>: ${esc(text)}`;
    this.log.appendChild(line);
    while (this.log.children.length > 60) this.log.firstChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}

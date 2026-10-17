import { bus } from '../core/bus';
import type { C2Social, Social2C } from '../../shared/social';
import { savedToken } from './api';

/** 소셜 서버 연결(전체 채팅·귓속말·파티·길드). 끊기면 잠시 뒤 다시 붙는다 */
export class SocialConnection {
  private ws: WebSocket | null = null;
  private charId = 0;
  private closed = false;
  private retry = 1000;
  private ping: ReturnType<typeof setInterval> | null = null;
  private queue: C2Social[] = [];

  connect(charId: number): void {
    this.charId = charId;
    this.open();
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/social?token=${savedToken()}&char=${this.charId}`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 1000;
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      if (this.ping) clearInterval(this.ping);
      this.ping = setInterval(() => this.send({ t: 'ping' }), 25_000);
    });
    ws.addEventListener('message', (e) => {
      try {
        bus.emit('social', JSON.parse(e.data as string) as Social2C);
      } catch {
        /* 무시 */
      }
    });
    ws.addEventListener('close', () => {
      if (this.ping) clearInterval(this.ping);
      if (this.ws !== ws || this.closed) return;
      setTimeout(() => !this.closed && this.open(), this.retry);
      this.retry = Math.min(15000, this.retry * 2);
    });
  }

  send(m: C2Social): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (m.t !== 'ping') this.queue.push(m);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}

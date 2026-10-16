import { bus } from '../core/bus';
import type { C2S, S2C } from '../../shared/protocol';
import { savedToken } from './api';

/**
 * 존 서버와의 웹소켓. 받은 메시지는 bus 'net'으로 흘리고,
 * 포탈 이동('goto')이면 새 존으로 다시 접속한다. 서버 시계와의 차이도 추정한다.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private charId = 0;
  private closedByUs = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** 서버 시각 - 내 시각(ms) */
  clockOffset = 0;
  /** 왕복 지연(ms) */
  rtt = 0;

  connect(charId: number): void {
    this.charId = charId;
    this.open();
  }

  private open(): void {
    const token = savedToken();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.closedByUs = false;
    bus.emit('connection', { state: 'connecting' });
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}&char=${this.charId}`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      bus.emit('connection', { state: 'open' });
      this.startPing();
    });
    ws.addEventListener('message', (e) => {
      let msg: S2C;
      try {
        msg = JSON.parse(e.data as string) as S2C;
      } catch {
        return;
      }
      if (msg.t === 'welcome') this.clockOffset = msg.time - Date.now();
      if (msg.t === 'pong') {
        this.rtt = Date.now() - msg.c;
        // 시계 차이는 천천히 따라간다(튀는 값 완화)
        const est = msg.time + this.rtt / 2 - Date.now();
        this.clockOffset += (est - this.clockOffset) * 0.2;
      }
      if (msg.t === 'goto') {
        // 서버가 저장을 끝냈으니 새 존으로 다시 접속
        this.closedByUs = true;
        ws.close();
        bus.emit('net', msg);
        setTimeout(() => this.open(), 50);
        return;
      }
      bus.emit('net', msg);
    });
    ws.addEventListener('close', (e) => {
      this.stopPing();
      if (this.ws === ws && !this.closedByUs) bus.emit('connection', { state: 'closed', reason: e.reason || '서버와 연결이 끊겼습니다.' });
    });
  }

  private startPing(): void {
    this.stopPing();
    const ping = () => this.send({ t: 'ping', c: Date.now() });
    ping();
    this.pingTimer = setInterval(ping, 2000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  send(msg: C2S): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** 서버 기준 현재 시각 */
  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  close(): void {
    this.closedByUs = true;
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }
}

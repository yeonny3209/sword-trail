import { DurableObject } from 'cloudflare:workers';
import { ZONES } from '../../shared/data';
import { dist2, resolveCircle } from '../../shared/geom';
import { SNAP_HZ, ZONE_HZ, type C2S, type S2C } from '../../shared/protocol';
import type { ZoneDef } from '../../shared/types';
import { loadCharacter, saveCharacter } from '../db';
import type { Env } from '../env';
import { PlayerSession } from './PlayerSession';

const PLAYER_RADIUS = 0.4;
const SAVE_EVERY_MS = 30_000;
const CHAT_MAX = 120;

/**
 * 존 하나(마을·필드·결투장)의 실시간 서버. 존마다 인스턴스가 하나씩 뜬다.
 * 20Hz로 몬스터·상태를 진행하고 10Hz로 스냅샷을 보낸다.
 */
export class ZoneDO extends DurableObject<Env> {
  private zone: ZoneDef | null = null;
  private readonly players = new Map<number, PlayerSession>();
  private readonly bySocket = new Map<WebSocket, PlayerSession>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private lastSave = Date.now();

  async fetch(req: Request): Promise<Response> {
    const zoneId = req.headers.get('X-Zone') ?? '';
    const charId = Number(req.headers.get('X-Char-Id'));
    if (!this.zone) this.zone = ZONES[zoneId] ?? null;
    if (!this.zone) return new Response('unknown zone', { status: 404 });
    // 같은 캐릭터가 이미 접속 중이면 이전 연결을 끊고(저장 후) 다시 불러온다
    const old = this.players.get(charId);
    if (old) await this.remove(old, '다른 곳에서 접속했습니다.');
    const row = await loadCharacter(this.env, charId);
    if (!row) return new Response('no character', { status: 404 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);

    const z = this.zone;
    const inZone = row.zone === z.id;
    const [x, zz] = resolveCircle(inZone ? row.x : z.spawn[0], inZone ? row.z : z.spawn[1], PLAYER_RADIUS, z.walls, z.size);
    const p = new PlayerSession(server, row, z.id, x, zz);
    this.players.set(p.id, p);
    this.bySocket.set(server, p);

    p.send({
      t: 'welcome', you: p.self(), zone: z.id, time: Date.now(),
      players: [...this.players.values()].filter((o) => o !== p).map((o) => o.info()),
      monsters: [],
    });
    this.broadcast({ t: 'join', p: p.info() }, p);
    this.broadcast({ t: 'sys', text: `${p.name}님이 ${z.name}에 들어왔습니다.` }, p);
    this.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const p = this.bySocket.get(ws);
    if (!p) {
      ws.close(4000, 'reconnect');
      return;
    }
    let msg: C2S;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as C2S;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'move': return this.onMove(p, msg);
      case 'act': return this.broadcast({ t: 'act', id: p.id, a: String(msg.a).slice(0, 32), f: Number(msg.f) || 0 }, p);
      case 'chat': return this.onChat(p, msg);
      case 'portal': return this.onPortal(p, msg.id);
      case 'ping': return p.send({ t: 'pong', c: msg.c, time: Date.now() });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const p = this.bySocket.get(ws);
    if (p) await this.remove(p);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private onMove(p: PlayerSession, m: Extract<C2S, { t: 'move' }>): void {
    if (p.leaving || !this.zone) return;
    const now = Date.now();
    const dt = Math.min(1, Math.max(0.05, (now - p.lastMoveAt) / 1000));
    p.lastMoveAt = now;
    let x = Number(m.x), z = Number(m.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    // 속도 검사: 대시·밀림을 감안해 넉넉하게, 넘으면 이동 방향으로 잘라낸다
    const maxStep = p.stats.speed * 2.4 * dt + 0.8;
    const dx = x - p.x, dz = z - p.z;
    const d = Math.hypot(dx, dz);
    let corrected = false;
    if (d > maxStep) {
      x = p.x + (dx / d) * maxStep;
      z = p.z + (dz / d) * maxStep;
      corrected = true;
    }
    const [rx, rz] = resolveCircle(x, z, PLAYER_RADIUS, this.zone.walls, this.zone.size);
    if (Math.hypot(rx - x, rz - z) > 0.4) corrected = true;
    p.x = rx;
    p.z = rz;
    p.y = Math.max(0, Math.min(8, Number(m.y) || 0));
    p.f = Number(m.f) || 0;
    p.st = m.st | 0;
    p.dirty = true;
    if (corrected) p.send({ t: 'pos', x: p.x, z: p.z });
  }

  private onChat(p: PlayerSession, m: Extract<C2S, { t: 'chat' }>): void {
    const text = String(m.text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!text) return;
    const now = Date.now();
    if (now - p.lastChatAt < 400) return p.send({ t: 'err', text: '채팅이 너무 빠릅니다.' });
    p.lastChatAt = now;
    this.broadcast({ t: 'chat', ch: 'zone', from: p.name, text });
  }

  private async onPortal(p: PlayerSession, portalId: string): Promise<void> {
    const z = this.zone;
    const portal = z?.portals.find((pt) => pt.id === portalId);
    if (!z || !portal || p.leaving) return;
    if (dist2(p.x, p.z, portal.x, portal.z) > (portal.r + 1.5) ** 2) return p.send({ t: 'err', text: '포탈에서 너무 멉니다.' });
    const dest = ZONES[portal.to];
    const arrive = dest?.portals.find((pt) => pt.id === portal.toPortal);
    if (!dest || !arrive) return;
    p.leaving = true;
    p.zone = dest.id;
    p.x = arrive.exit[0];
    p.z = arrive.exit[1];
    await this.save(p);
    p.send({ t: 'goto', zone: dest.id });
    await this.remove(p);
  }

  private async remove(p: PlayerSession, reason?: string): Promise<void> {
    if (!this.players.has(p.id) || this.players.get(p.id) !== p) return;
    this.players.delete(p.id);
    this.bySocket.delete(p.ws);
    if (reason) p.send({ t: 'err', text: reason });
    try {
      p.ws.close(1000, 'bye');
    } catch {
      /* 이미 닫힘 */
    }
    if (!p.leaving) await this.save(p);
    this.broadcast({ t: 'leave', id: p.id });
    if (this.players.size === 0) this.stop();
  }

  private async save(p: PlayerSession): Promise<void> {
    await saveCharacter(this.env, { id: p.id, level: p.lv, zone: p.zone, x: p.x, z: p.z, data: p.data });
    p.dirty = false;
  }

  private broadcast(msg: S2C, except?: PlayerSession): void {
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p === except) continue;
      try {
        p.ws.send(text);
      } catch {
        /* 끊긴 연결은 close 이벤트에서 정리 */
      }
    }
  }

  private start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), 1000 / ZONE_HZ);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 20Hz 진행 */
  private step(): void {
    this.tickCount++;
    if (this.tickCount % (ZONE_HZ / SNAP_HZ) === 0) {
      this.broadcast({ t: 'snap', time: Date.now(), p: [...this.players.values()].map((p) => p.snap()), m: [] });
    }
    const now = Date.now();
    if (now - this.lastSave > SAVE_EVERY_MS) {
      this.lastSave = now;
      for (const p of this.players.values()) if (p.dirty && !p.leaving) void this.save(p);
    }
  }
}

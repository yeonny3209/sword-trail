import { DurableObject } from 'cloudflare:workers';
import { MONSTERS, ZONES } from '../../shared/data';
import { dist2, resolveCircle } from '../../shared/geom';
import { SNAP_HZ, ZONE_HZ, type C2S, type S2C } from '../../shared/protocol';
import type { ZoneDef } from '../../shared/types';
import { loadCharacter, saveCharacter } from '../db';
import type { Env } from '../env';
import { Combat } from './Combat';
import { Monster } from './Monster';
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
  private lastStep = Date.now();
  readonly monsters = new Map<number, Monster>();
  private combat: Combat | null = null;

  /** 존을 처음 열 때 몬스터를 배치한다 */
  private init(zoneId: string): boolean {
    if (this.zone) return true;
    const z = ZONES[zoneId];
    if (!z) return false;
    this.zone = z;
    for (const s of z.spawns) {
      const def = MONSTERS[s.monster];
      if (!def) continue;
      for (let i = 0; i < s.count; i++) {
        const m = new Monster(def, s.area, z);
        this.monsters.set(m.id, m);
      }
    }
    const self = this;
    this.combat = new Combat({ zone: z, monsters: this.monsters, broadcast: (m, e) => self.broadcast(m, e) });
    return true;
  }

  async fetch(req: Request): Promise<Response> {
    const zoneId = req.headers.get('X-Zone') ?? '';
    const charId = Number(req.headers.get('X-Char-Id'));
    if (!this.init(zoneId) || !this.zone) return new Response('unknown zone', { status: 404 });
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
      monsters: [...this.monsters.values()].filter((m) => !m.dead).map((m) => m.info()),
    });
    if (p.dead) p.send({ t: 'died', wait: 0 });
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
      case 'act': return this.combat?.onAct(p, msg);
      case 'hit': return this.combat?.onHit(p, msg);
      case 'hurt': return this.combat?.onHurt(p, msg);
      case 'revive': return this.combat?.onRevive(p);
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
    if (p.leaving || p.dead || !this.zone) return;
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

  /** 몬스터끼리 겹치지 않게 살짝 밀어낸다(띄워진 몬스터는 제외) */
  private separate(): void {
    const list = [...this.monsters.values()].filter((m) => !m.dead && !m.body.air);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].body, b = list[j].body;
        const min = list[i].def.radius + list[j].def.radius;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
      }
    }
  }

  /** 20Hz 진행: 몬스터 → 스냅샷 → 회복·저장 */
  private step(): void {
    this.tickCount++;
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastStep) / 1000);
    this.lastStep = now;
    const z = this.zone!;
    const emit = (msg: S2C) => this.broadcast(msg);
    for (const m of this.monsters.values()) {
      if (m.dead) {
        m.respawnT -= dt;
        if (m.respawnT <= 0) {
          m.respawn(z);
          this.broadcast({ t: 'mspawn', m: m.info() });
        }
        continue;
      }
      m.update(dt, z, this.players.values(), emit);
    }
    this.separate();
    if (this.tickCount % (ZONE_HZ / SNAP_HZ) === 0) {
      this.broadcast({
        t: 'snap', time: now,
        p: [...this.players.values()].map((p) => p.snap()),
        m: [...this.monsters.values()].filter((m) => !m.dead).map((m) => m.snap()),
      });
    }
    if (this.tickCount % ZONE_HZ === 0) for (const p of this.players.values()) this.combat?.regen(p);
    if (now - this.lastSave > SAVE_EVERY_MS) {
      this.lastSave = now;
      for (const p of this.players.values()) if (p.dirty && !p.leaving) void this.save(p);
    }
  }
}

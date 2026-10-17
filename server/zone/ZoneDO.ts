import { DurableObject } from 'cloudflare:workers';
import { baseZone, MONSTERS, ZONES } from '../../shared/data';
import { resolveCircle } from '../../shared/geom';
import { SNAP_HZ, ZONE_HZ, type C2S, type S2C } from '../../shared/protocol';
import type { MonsterDef, ZoneDef } from '../../shared/types';
import { loadCharacter, saveCharacter } from '../db';
import type { Env } from '../env';
import { Combat } from './Combat';
import { Monster } from './Monster';
import { PlayerSession } from './PlayerSession';
import { onReset, onSkill, onStat } from './Progress';
import { onInventory, syncInv } from './Inventory';
import { guildNameOf } from '../social/Guilds';
import { applyMove, PLAYER_RADIUS } from './Movement';
import { createGuildAt, portalTarget } from './Travel';
import { RaidSystem } from './Raid';
import { StatusSystem } from './Status';
import { EliteSystem } from './Elite';
import { QuestSystem } from './Quests';
import { GatherSystem, onCraft } from './Gather';
import { Market, MARKET_MSGS, type MarketMsg } from './Market';
import { TradeSystem, TRADE_MSGS, type TradeMsg } from './Trade';
import { PvpSystem } from './Pvp';


const SAVE_EVERY_MS = 10_000;
const CHAT_MAX = 120;

/**
 * 존 하나(마을·필드·결투장)의 실시간 서버. 존마다 인스턴스가 하나씩 뜬다.
 * 20Hz로 몬스터·상태를 진행하고 10Hz로 스냅샷을 보낸다.
 */
export class ZoneDO extends DurableObject<Env> {
  private zone: ZoneDef | null = null;
  /** 존 서버 이름: 마을·필드는 존 id, 레이드는 `raid1~파티번호` */
  private key = '';
  private raid: RaidSystem | null = null;
  private status: StatusSystem | null = null;
  private elite: EliteSystem | null = null;
  private readonly players = new Map<number, PlayerSession>();
  private readonly bySocket = new Map<WebSocket, PlayerSession>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private lastSave = Date.now();
  private lastStep = Date.now();
  readonly monsters = new Map<number, Monster>();
  private combat: Combat | null = null;
  private quests: QuestSystem | null = null;
  private gather: GatherSystem | null = null;
  private market: Market | null = null;
  private trade: TradeSystem | null = null;
  private pvp: PvpSystem | null = null;

  /** 존을 처음 열 때 몬스터를 배치한다 */
  private init(zoneId: string): boolean {
    if (this.zone) return true;
    const z = ZONES[baseZone(zoneId)];
    if (!z) return false;
    this.zone = z;
    this.key = zoneId;
    for (const s of z.spawns) {
      const def = MONSTERS[s.monster];
      if (!def) continue;
      for (let i = 0; i < s.count; i++) {
        const m = new Monster(def, s.area, z);
        this.monsters.set(m.id, m);
      }
    }
    const self = this;
    this.combat = new Combat({
      zone: z, monsters: this.monsters, broadcast: (m, e) => self.broadcast(m, e), players: this.players,
      onKill: (p, id) => self.quests?.onKill(p, id),
      onRaidClear: (m) => self.raid?.clear(m),
      onCast: (p, a, slv) => self.status?.schedule(p, a, slv),
    });
    this.status = new StatusSystem({ players: this.players, monsters: this.monsters, broadcast: (m, e) => self.broadcast(m, e), combat: this.combat });
    this.elite = new EliteSystem({ zone: z, players: this.players, broadcast: (m) => self.broadcast(m), spawn: (def, x, zz) => self.spawnMonster(def, x, zz) });
    this.quests = new QuestSystem(z, (p, n) => self.combat!.gainExp(p, n));
    this.gather = new GatherSystem(z, (m) => self.broadcast(m));
    this.market = new Market({
      env: this.env, zone: z, save: (p) => self.save(p),
      notify: (id, text) => void self.social().notify(id, text).catch(() => undefined),
    });
    this.trade = new TradeSystem(this.players, (p) => self.save(p), (id) => self.market!.isBusy(id));
    if (z.type === 'raid') this.initRaid(z);
    this.pvp = new PvpSystem({ env: this.env, zone: z, players: this.players, combat: this.combat, broadcast: (m, e) => self.broadcast(m, e) });
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
    const inZone = row.zone === this.key;
    const [x, zz] = resolveCircle(inZone ? row.x : z.spawn[0], inZone ? row.z : z.spawn[1], PLAYER_RADIUS, z.walls, z.size);
    const p = new PlayerSession(server, row, this.key, x, zz);
    // 길드 이름과 파티 구성을 먼저 알아 둔다(소셜 DO가 없거나 늦으면 건너뜀)
    p.guild = await guildNameOf(this.env, p.id).catch(() => null);
    p.party = await this.social().entered(p.id, this.key, p.lv).catch(() => [] as number[]);
    this.players.set(p.id, p);
    this.bySocket.set(server, p);
    this.raid?.scale(this.players.size, p);

    p.send({
      t: 'welcome', you: p.self(), zone: z.id, time: Date.now(),
      players: [...this.players.values()].filter((o) => o !== p).map((o) => o.info()),
      monsters: [...this.monsters.values()].filter((m) => !m.dead).map((m) => m.info()),
    });
    syncInv(p);
    this.quests!.send(p);
    this.quests!.onEnterZone(p);
    p.send({ t: 'nodes', down: this.gather!.downList() });
    if (p.dead) p.send({ t: 'died', wait: 0 });
    void this.market!.onConnect(p).catch(() => undefined);
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
      case 'move': return void (this.zone && applyMove(this.zone, p, msg));
      case 'act': return this.combat?.onAct(p, msg);
      case 'hit': return this.combat?.onHit(p, msg);
      case 'hurt': return this.combat?.onHurt(p, msg);
      case 'revive': return this.combat?.onRevive(p);
      case 'stat': return onStat(p, msg);
      case 'skill': return onSkill(p, msg);
      case 'reset': return onReset(p);
      case 'equip':
      case 'unequip':
      case 'use':
      case 'pot':
      case 'buy':
      case 'sell':
      case 'enhance':
      case 'discard':
        return onInventory(p, msg, this.zone!);
      case 'qaccept': return this.quests?.onAccept(p, String(msg.id));
      case 'qturnin': return this.quests?.onTurnin(p, String(msg.id));
      case 'qabandon': return this.quests?.onAbandon(p, String(msg.id));
      case 'gather': return this.gather?.onStart(p, msg.i | 0);
      case 'gatherdone': return this.gather?.onDone(p, msg.i | 0);
      case 'craft': return onCraft(p, this.zone!, String(msg.id));
      case 'gcreate': return createGuildAt(this.env, this.zone, p, String(msg.name), (q) => this.save(q));
      case 'raise': return this.status?.raise(p, msg.id | 0);
      case 'phit': return this.pvp?.onHit(p, msg);
      case 'phurt': return this.pvp?.onHurt(p, msg);
      case 'pvprank': return this.pvp?.onRank(p);
      case 'chat': return this.onChat(p, msg);
      case 'portal': return this.onPortal(p, msg.id);
      case 'ping': return p.send({ t: 'pong', c: msg.c, time: Date.now() });
      default:
        if (MARKET_MSGS.has(msg.t)) return this.market?.on(p, msg as MarketMsg);
        if (TRADE_MSGS.has(msg.t)) return this.trade?.on(p, msg as TradeMsg);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const p = this.bySocket.get(ws);
    if (p) await this.remove(p);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private social() {
    return this.env.SOCIAL.get(this.env.SOCIAL.idFromName('global'));
  }

  /** RPC(소셜 DO): 파티 구성이 바뀌었다 */
  async setParty(id: number, members: number[]): Promise<void> {
    const p = this.players.get(id);
    if (p) p.party = members;
  }

  /** RPC(소셜 DO): 길드 가입·탈퇴 — 이름표 갱신 */
  async setGuild(id: number, name: string | null): Promise<void> {
    const p = this.players.get(id);
    if (!p) return;
    p.guild = name;
    this.broadcast({ t: 'pinfo', p: p.info() });
  }

  /** 레이드 존: 보스 진행 시스템을 붙인다 */
  private initRaid(z: ZoneDef): void {
    const self = this;
    this.raid = new RaidSystem({
      zone: z, players: this.players, broadcast: (m, e) => self.broadcast(m, e),
      spawn: (def, x, zz) => self.spawnMonster(def, x, zz),
      gainExp: (p, n) => self.combat!.gainExp(p, n),
      onKill: (p, id) => self.quests?.onKill(p, id),
      mailItem: (p, it, subject) => self.market!.mailItem(p.id, it, subject),
      save: (p) => self.save(p),
    });
    const boss = [...this.monsters.values()].find((m) => m.def.raid);
    if (boss) this.raid.bind(boss);
  }

  /** 모두 나간 레이드 방을 처음 상태로 되돌린다(다음 입장 때 init이 새로 만든다) */
  private resetRaid(): void {
    this.zone = null;
    this.raid = this.combat = this.quests = this.gather = this.market = this.trade = this.pvp = this.status = this.elite = null;
    this.monsters.clear();
  }

  private spawnMonster(def: MonsterDef, x: number, z: number): Monster {
    const m = new Monster(def, { x, z, w: 1, d: 1 }, this.zone!);
    this.monsters.set(m.id, m);
    this.broadcast({ t: 'mspawn', m: m.info() });
    return m;
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
    if (!this.zone || p.leaving) return;
    const t = portalTarget(this.zone, p, portalId);
    if (!t) return;
    if (typeof t === 'string') return p.send({ t: 'err', text: t });
    p.leaving = true;
    p.zone = t.key;
    p.x = t.x;
    p.z = t.z;
    await this.save(p);
    p.send({ t: 'goto', zone: t.id });
    await this.remove(p);
  }

  private async remove(p: PlayerSession, reason?: string): Promise<void> {
    if (!this.players.has(p.id) || this.players.get(p.id) !== p) return;
    this.players.delete(p.id);
    this.bySocket.delete(p.ws);
    this.trade?.onLeave(p);
    this.raid?.scale(this.players.size);
    if (reason) p.send({ t: 'err', text: reason });
    try {
      p.ws.close(1000, 'bye');
    } catch {
      /* 이미 닫힘 */
    }
    if (!p.leaving) await this.save(p);
    this.broadcast({ t: 'leave', id: p.id });
    if (this.players.size === 0) {
      this.stop();
      // 레이드 방은 모두 나가면 처음 상태로(다음에 들어오면 새 보스)
      if (this.zone?.type === 'raid') this.resetRaid();
    }
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
          if (m.summoned || m.temporary) {
            this.monsters.delete(m.id);
            continue;
          }
          m.respawn(z);
          this.broadcast({ t: 'mspawn', m: m.info() });
        }
        continue;
      }
      m.update(dt, z, this.players.values(), emit);
    }
    this.separate();
    this.raid?.update(now);
    // 효과·이벤트 처리에서 오류가 나도 존 진행(몬스터·스냅샷)은 멈추지 않게 한다
    try {
      this.status?.update(now);
      this.elite?.update(now);
    } catch (e) {
      console.error('status/elite update', e);
    }
    if (this.tickCount % (ZONE_HZ / SNAP_HZ) === 0) {
      this.broadcast({
        t: 'snap', time: now,
        p: [...this.players.values()].map((p) => p.snap()),
        m: [...this.monsters.values()].filter((m) => !m.dead).map((m) => m.snap()),
      });
    }
    if (this.tickCount % ZONE_HZ === 0) {
      for (const p of this.players.values()) this.combat?.regen(p);
      this.gather?.update(now);
      this.trade?.update();
    }
    if (now - this.lastSave > SAVE_EVERY_MS) {
      this.lastSave = now;
      for (const p of this.players.values()) if (p.dirty && !p.leaving) void this.save(p);
    }
  }
}

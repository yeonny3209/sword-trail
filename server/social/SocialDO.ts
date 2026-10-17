import { DurableObject } from 'cloudflare:workers';
import { MAX_PARTY, type C2Social, type PartyMember, type Social2C } from '../../shared/social';
import type { ClassId } from '../../shared/types';
import { loadCharacter } from '../db';
import type { Env } from '../env';
import * as G from './Guilds';

/** 소켓에 붙여 두는 정보(DO가 잠들었다 깨도 남는다) */
interface Att {
  id: number;
  name: string;
  cls: ClassId;
  lv: number;
  zone: string;
  gid: number | null;
  lastChat: number;
}

interface Party {
  id: number;
  leader: number;
  members: number[];
}

const INVITE_MS = 60_000;

/**
 * 존을 넘나드는 기능을 맡는 단일 DO: 접속자 목록, 전체 채팅·귓속말·파티·길드 채팅, 파티, 길드.
 * 잠들어도(하이버네이션) 소켓 정보는 첨부로, 파티는 저장소로 되살린다.
 */
export class SocialDO extends DurableObject<Env> {
  private readonly online = new Map<number, WebSocket>();
  private readonly byName = new Map<string, number>();
  private parties = new Map<number, Party>();
  private readonly partyOf = new Map<number, number>();
  private nextParty = 1;
  private readonly invites = new Map<number, { from: number; at: number }>();
  private readonly ginvites = new Map<number, { gid: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Att | null;
        if (a) this.track(ws, a);
      }
      const saved = await ctx.storage.get<Party[]>('parties');
      for (const p of saved ?? []) {
        const members = p.members.filter((m) => this.online.has(m));
        if (members.length < 2) continue;
        this.parties.set(p.id, { ...p, members, leader: members.includes(p.leader) ? p.leader : members[0] });
        for (const m of members) this.partyOf.set(m, p.id);
        this.nextParty = Math.max(this.nextParty, p.id + 1);
      }
    });
  }

  private track(ws: WebSocket, a: Att): void {
    this.online.set(a.id, ws);
    this.byName.set(a.name.toLowerCase(), a.id);
  }

  private att(id: number): Att | null {
    const ws = this.online.get(id);
    return ws ? (ws.deserializeAttachment() as Att) : null;
  }

  private send(id: number, m: Social2C): void {
    try {
      this.online.get(id)?.send(JSON.stringify(m));
    } catch {
      /* 끊김 */
    }
  }

  private all(m: Social2C): void {
    const s = JSON.stringify(m);
    for (const ws of this.online.values()) {
      try {
        ws.send(s);
      } catch {
        /* 끊김 */
      }
    }
  }

  async fetch(req: Request): Promise<Response> {
    const id = Number(req.headers.get('X-Char-Id'));
    const row = await loadCharacter(this.env, id);
    if (!row) return new Response('no character', { status: 404 });
    // 같은 캐릭터의 이전 연결은 닫는다
    const old = this.online.get(id);
    if (old) {
      this.online.delete(id);
      try {
        old.close(1000, 'replaced');
      } catch {
        /* 이미 닫힘 */
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const a: Att = { id, name: row.name, cls: row.class, lv: row.level, zone: row.zone, gid: await G.guildIdOf(this.env, id), lastChat: 0 };
    server.serializeAttachment(a);
    this.track(server, a);
    this.all({ t: 'online', n: this.online.size });
    if (a.gid) {
      await this.pushGuild(a.gid);
      await this.guildSay(a.gid, `${a.name}님이 접속했습니다.`, id);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Att | null;
    if (!a) return;
    if (!this.online.has(a.id)) this.track(ws, a);
    let m: C2Social;
    try {
      m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as C2Social;
    } catch {
      return;
    }
    switch (m.t) {
      case 'ping': return this.send(a.id, { t: 'pong' });
      case 'where': {
        a.lv = m.lv | 0;
        ws.serializeAttachment(a);
        const pid = this.partyOf.get(a.id);
        if (pid) this.pushParty(pid);
        return;
      }
      case 'chat': return this.chat(ws, a, m);
      case 'pinvite': return this.partyInvite(a, String(m.name));
      case 'preply': return this.partyReply(a, m.from | 0, !!m.ok);
      case 'pleave': return this.leaveParty(a.id);
      case 'pkick': {
        const p = this.parties.get(this.partyOf.get(a.id) ?? -1);
        if (!p || p.leader !== a.id || !p.members.includes(m.id) || m.id === a.id) return;
        this.send(m.id, { t: 'sys', text: '파티에서 추방되었습니다.' });
        return this.leaveParty(m.id);
      }
      case 'ginvite': return this.guildInvite(a, String(m.name));
      case 'greply': return this.guildReply(ws, a, m.gid | 0, !!m.ok);
      case 'gleave': return this.guildLeave(ws, a);
      case 'gkick': return this.guildKick(a, m.id | 0);
      case 'gnotice': {
        if (!a.gid || (await G.rankOf(this.env, a.id)) < 1) return;
        await G.setNotice(this.env, a.gid, String(m.text));
        return this.pushGuild(a.gid);
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Att | null;
    if (!a || this.online.get(a.id) !== ws) return;
    this.online.delete(a.id);
    this.byName.delete(a.name.toLowerCase());
    this.leaveParty(a.id, true);
    this.all({ t: 'online', n: this.online.size });
    if (a.gid) {
      await this.pushGuild(a.gid);
      await this.guildSay(a.gid, `${a.name}님이 나갔습니다.`, a.id);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ───────── 채팅 ─────────
  private async chat(ws: WebSocket, a: Att, m: Extract<C2Social, { t: 'chat' }>): Promise<void> {
    const text = String(m.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text) return;
    const now = Date.now();
    if (now - a.lastChat < 500) return this.send(a.id, { t: 'err', text: '채팅이 너무 빠릅니다.' });
    a.lastChat = now;
    ws.serializeAttachment(a);
    if (m.ch === 'world') return this.all({ t: 'chat', ch: 'world', from: a.name, text });
    if (m.ch === 'whisper') {
      const to = this.byName.get(String(m.to ?? '').toLowerCase());
      if (!to) return this.send(a.id, { t: 'err', text: `${m.to}님은 접속해 있지 않습니다.` });
      this.send(to, { t: 'chat', ch: 'whisper', from: a.name, text });
      return this.send(a.id, { t: 'chat', ch: 'whisper', from: `→ ${this.att(to)?.name ?? m.to}`, text });
    }
    if (m.ch === 'party') {
      const p = this.parties.get(this.partyOf.get(a.id) ?? -1);
      if (!p) return this.send(a.id, { t: 'err', text: '파티에 들어가 있지 않습니다.' });
      for (const id of p.members) this.send(id, { t: 'chat', ch: 'party', from: a.name, text });
      return;
    }
    if (m.ch === 'guild') {
      if (!a.gid) return this.send(a.id, { t: 'err', text: '길드에 들어가 있지 않습니다.' });
      for (const id of await G.memberIds(this.env, a.gid)) this.send(id, { t: 'chat', ch: 'guild', from: a.name, text });
    }
  }

  // ───────── 파티 ─────────
  private member(id: number): PartyMember | null {
    const a = this.att(id);
    return a ? { id, name: a.name, cls: a.cls, lv: a.lv, zone: a.zone, online: true } : null;
  }

  private partyInvite(a: Att, name: string): void {
    const to = this.byName.get(name.toLowerCase());
    if (!to || to === a.id) return this.send(a.id, { t: 'err', text: `${name}님을 찾을 수 없습니다.` });
    if (this.partyOf.has(to)) return this.send(a.id, { t: 'err', text: '이미 다른 파티에 있습니다.' });
    const mine = this.parties.get(this.partyOf.get(a.id) ?? -1);
    if (mine && mine.leader !== a.id) return this.send(a.id, { t: 'err', text: '파티장만 초대할 수 있습니다.' });
    if (mine && mine.members.length >= MAX_PARTY) return this.send(a.id, { t: 'err', text: `파티는 ${MAX_PARTY}명까지입니다.` });
    this.invites.set(to, { from: a.id, at: Date.now() });
    this.send(to, { t: 'pinvite', from: a.id, name: a.name });
    this.send(a.id, { t: 'sys', text: `${this.att(to)?.name}님을 파티에 초대했습니다.` });
  }

  private partyReply(a: Att, from: number, ok: boolean): void {
    const inv = this.invites.get(a.id);
    this.invites.delete(a.id);
    if (!inv || inv.from !== from || Date.now() - inv.at > INVITE_MS || !this.online.has(from)) return;
    if (!ok) return this.send(from, { t: 'sys', text: `${a.name}님이 파티 초대를 거절했습니다.` });
    if (this.partyOf.has(a.id)) return;
    let p = this.parties.get(this.partyOf.get(from) ?? -1);
    if (!p) {
      p = { id: this.nextParty++, leader: from, members: [from] };
      this.parties.set(p.id, p);
      this.partyOf.set(from, p.id);
    }
    if (p.members.length >= MAX_PARTY) return this.send(a.id, { t: 'err', text: '파티가 가득 찼습니다.' });
    p.members.push(a.id);
    this.partyOf.set(a.id, p.id);
    for (const id of p.members) this.send(id, { t: 'sys', text: `${a.name}님이 파티에 들어왔습니다.` });
    this.pushParty(p.id);
  }

  private leaveParty(id: number, quiet = false): void {
    const pid = this.partyOf.get(id);
    const p = pid ? this.parties.get(pid) : null;
    if (!p) return;
    p.members = p.members.filter((m) => m !== id);
    this.partyOf.delete(id);
    this.send(id, { t: 'noparty' });
    this.notifyZone(id, []);
    const name = this.att(id)?.name ?? '';
    if (p.members.length < 2) {
      for (const m of p.members) {
        this.partyOf.delete(m);
        this.send(m, { t: 'noparty' });
        this.send(m, { t: 'sys', text: '파티가 해산되었습니다.' });
        this.notifyZone(m, []);
      }
      this.parties.delete(p.id);
    } else {
      if (p.leader === id) p.leader = p.members[0];
      if (!quiet || name) for (const m of p.members) this.send(m, { t: 'sys', text: `${name}님이 파티를 떠났습니다.` });
      this.pushParty(p.id);
    }
    void this.saveParties();
  }

  private pushParty(pid: number): void {
    const p = this.parties.get(pid);
    if (!p) return;
    const members = p.members.map((m) => this.member(m)).filter(Boolean) as PartyMember[];
    for (const m of p.members) {
      this.send(m, { t: 'party', leader: p.leader, members });
      this.notifyZone(m, p.members);
    }
    void this.saveParties();
  }

  /** 존 DO에 파티 구성을 알려 경험치를 나누게 한다 */
  private notifyZone(id: number, members: number[]): void {
    const zone = this.att(id)?.zone;
    if (!zone) return;
    const stub = this.env.ZONE.get(this.env.ZONE.idFromName(zone));
    stub.setParty(id, members).catch(() => undefined);
  }

  private async saveParties(): Promise<void> {
    await this.ctx.storage.put('parties', [...this.parties.values()]);
  }

  /** RPC: 접속 중이면 알림 한 줄(경매 판매·우편 도착 등) */
  async notify(id: number, text: string): Promise<void> {
    this.send(id, { t: 'sys', text });
  }

  /** RPC: 존 DO가 플레이어 입장을 알린다(있는 곳·레벨 갱신) → 파티 구성을 돌려준다 */
  async entered(id: number, zone: string, lv: number): Promise<number[]> {
    const ws = this.online.get(id);
    const a = this.att(id);
    if (ws && a) {
      a.zone = zone;
      a.lv = lv;
      ws.serializeAttachment(a);
    }
    const pid = this.partyOf.get(id);
    if (pid) this.pushParty(pid);
    const p = this.parties.get(pid ?? -1);
    return p ? [...p.members] : [];
  }

  // ───────── 길드 ─────────
  private onlineInfo = (id: number): { zone: string; lv: number } | null => {
    const a = this.att(id);
    return a ? { zone: a.zone, lv: a.lv } : null;
  };

  private async pushGuild(gid: number): Promise<void> {
    const g = await G.guildInfo(this.env, gid, this.onlineInfo);
    if (!g) return;
    for (const m of g.members) if (m.online) this.send(m.id, { t: 'guild', g });
  }

  private async guildSay(gid: number, text: string, except?: number): Promise<void> {
    for (const id of await G.memberIds(this.env, gid)) if (id !== except) this.send(id, { t: 'sys', text: `[길드] ${text}` });
  }

  private setGid(id: number, gid: number | null, gname: string | null): void {
    const ws = this.online.get(id);
    const a = this.att(id);
    if (ws && a) {
      a.gid = gid;
      ws.serializeAttachment(a);
      const stub = this.env.ZONE.get(this.env.ZONE.idFromName(a.zone));
      stub.setGuild(id, gname).catch(() => undefined);
    }
    if (!gid) this.send(id, { t: 'noguild' });
  }

  /** RPC: 존 DO(길드 관리인)가 골드를 받은 뒤 길드를 만든다 */
  async createGuild(id: number, name: string): Promise<{ ok: boolean; error?: string }> {
    const r = await G.createGuild(this.env, id, name);
    if (!r.ok) return r;
    this.setGid(id, r.gid, name);
    await this.pushGuild(r.gid);
    this.all({ t: 'sys', text: `새 길드 <${name}>이(가) 창설되었습니다!` });
    return { ok: true };
  }

  private async guildInvite(a: Att, name: string): Promise<void> {
    if (!a.gid || (await G.rankOf(this.env, a.id)) < 1) return this.send(a.id, { t: 'err', text: '길드장·부길드장만 초대할 수 있습니다.' });
    const to = this.byName.get(name.toLowerCase());
    const ta = to ? this.att(to) : null;
    if (!to || !ta) return this.send(a.id, { t: 'err', text: `${name}님을 찾을 수 없습니다.` });
    if (ta.gid) return this.send(a.id, { t: 'err', text: '이미 길드에 들어가 있습니다.' });
    const g = await G.guildInfo(this.env, a.gid, () => null);
    this.ginvites.set(to, { gid: a.gid, at: Date.now() });
    this.send(to, { t: 'ginvite', gid: a.gid, gname: g?.name ?? '', from: a.name });
    this.send(a.id, { t: 'sys', text: `${ta.name}님을 길드에 초대했습니다.` });
  }

  private async guildReply(ws: WebSocket, a: Att, gid: number, ok: boolean): Promise<void> {
    const inv = this.ginvites.get(a.id);
    this.ginvites.delete(a.id);
    if (!inv || inv.gid !== gid || Date.now() - inv.at > INVITE_MS || !ok) return;
    const err = await G.joinGuild(this.env, a.id, gid);
    if (err) return this.send(a.id, { t: 'err', text: err });
    const g = await G.guildInfo(this.env, gid, () => null);
    void ws;
    this.setGid(a.id, gid, g?.name ?? null);
    await this.guildSay(gid, `${a.name}님이 길드에 가입했습니다.`);
    await this.pushGuild(gid);
  }

  private async guildLeave(ws: WebSocket, a: Att): Promise<void> {
    const r = await G.leaveGuild(this.env, a.id);
    if (!r) return;
    void ws;
    this.setGid(a.id, null, null);
    this.send(a.id, { t: 'sys', text: r.disbanded ? '길드를 해산했습니다.' : '길드에서 탈퇴했습니다.' });
    if (!r.disbanded) {
      await this.guildSay(r.gid, `${a.name}님이 길드를 떠났습니다.`);
      await this.pushGuild(r.gid);
    }
  }

  private async guildKick(a: Att, id: number): Promise<void> {
    if (!a.gid || id === a.id) return;
    const [mine, theirs, theirGid] = await Promise.all([G.rankOf(this.env, a.id), G.rankOf(this.env, id), G.guildIdOf(this.env, id)]);
    if (theirGid !== a.gid || mine < 1 || theirs >= mine) return this.send(a.id, { t: 'err', text: '추방할 수 없습니다.' });
    await G.leaveGuild(this.env, id);
    this.setGid(id, null, null);
    this.send(id, { t: 'sys', text: '길드에서 추방되었습니다.' });
    await this.pushGuild(a.gid);
  }
}

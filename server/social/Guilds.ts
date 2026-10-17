import { GUILD_NAME_RE, MAX_GUILD, type GuildInfo } from '../../shared/social';
import type { ClassId } from '../../shared/types';
import type { Env } from '../env';

/** 길드 D1 작업 모음(소셜 DO와 존 DO가 함께 쓴다) */

export async function guildIdOf(env: Env, charId: number): Promise<number | null> {
  const r = await env.DB.prepare('SELECT guild_id FROM guild_members WHERE char_id = ?').bind(charId).first<{ guild_id: number }>();
  return r?.guild_id ?? null;
}

export async function guildNameOf(env: Env, charId: number): Promise<string | null> {
  const r = await env.DB.prepare('SELECT g.name FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.char_id = ?')
    .bind(charId).first<{ name: string }>();
  return r?.name ?? null;
}

export async function rankOf(env: Env, charId: number): Promise<number> {
  const r = await env.DB.prepare('SELECT rank FROM guild_members WHERE char_id = ?').bind(charId).first<{ rank: number }>();
  return r?.rank ?? -1;
}

/** 길드 정보(접속 여부는 online 함수로) */
export async function guildInfo(env: Env, gid: number, online: (id: number) => { zone: string; lv: number } | null): Promise<GuildInfo | null> {
  const g = await env.DB.prepare('SELECT id, name, notice FROM guilds WHERE id = ?').bind(gid).first<{ id: number; name: string; notice: string }>();
  if (!g) return null;
  const { results } = await env.DB.prepare(
    'SELECT c.id, c.name, c.class, c.level, c.zone, m.rank FROM guild_members m JOIN characters c ON c.id = m.char_id WHERE m.guild_id = ? ORDER BY m.rank DESC, c.level DESC',
  ).bind(gid).all<{ id: number; name: string; class: ClassId; level: number; zone: string; rank: number }>();
  return {
    id: g.id, name: g.name, notice: g.notice,
    members: results.map((r) => {
      const o = online(r.id);
      return { id: r.id, name: r.name, cls: r.class, lv: o?.lv ?? r.level, zone: o?.zone ?? r.zone, online: !!o, rank: r.rank };
    }),
  };
}

export async function memberIds(env: Env, gid: number): Promise<number[]> {
  const { results } = await env.DB.prepare('SELECT char_id FROM guild_members WHERE guild_id = ?').bind(gid).all<{ char_id: number }>();
  return results.map((r) => r.char_id);
}

export async function createGuild(env: Env, charId: number, name: string): Promise<{ ok: true; gid: number } | { ok: false; error: string }> {
  if (!GUILD_NAME_RE.test(name)) return { ok: false, error: '길드 이름은 한글·영문·숫자 2~10자입니다.' };
  if (await guildIdOf(env, charId)) return { ok: false, error: '이미 길드에 들어가 있습니다.' };
  const taken = await env.DB.prepare('SELECT id FROM guilds WHERE name = ?').bind(name).first();
  if (taken) return { ok: false, error: '이미 있는 길드 이름입니다.' };
  const now = Date.now();
  const r = await env.DB.prepare('INSERT INTO guilds (name, leader_id, notice, created_at) VALUES (?, ?, ?, ?)')
    .bind(name, charId, `${name} 길드에 오신 것을 환영합니다!`, now).run();
  const gid = Number(r.meta.last_row_id);
  await env.DB.prepare('INSERT INTO guild_members (char_id, guild_id, rank, joined_at) VALUES (?, ?, 2, ?)').bind(charId, gid, now).run();
  return { ok: true, gid };
}

export async function joinGuild(env: Env, charId: number, gid: number): Promise<string | null> {
  if (await guildIdOf(env, charId)) return '이미 길드에 들어가 있습니다.';
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM guild_members WHERE guild_id = ?').bind(gid).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_GUILD) return '길드 인원이 가득 찼습니다.';
  await env.DB.prepare('INSERT INTO guild_members (char_id, guild_id, rank, joined_at) VALUES (?, ?, 0, ?)').bind(charId, gid, Date.now()).run();
  return null;
}

/** 탈퇴: 길드장이 나가면 가장 높은 길드원에게 넘기고, 아무도 없으면 해산 */
export async function leaveGuild(env: Env, charId: number): Promise<{ gid: number; disbanded: boolean; newLeader?: number } | null> {
  const gid = await guildIdOf(env, charId);
  if (!gid) return null;
  const rank = await rankOf(env, charId);
  await env.DB.prepare('DELETE FROM guild_members WHERE char_id = ?').bind(charId).run();
  const next = await env.DB.prepare('SELECT char_id FROM guild_members WHERE guild_id = ? ORDER BY rank DESC, joined_at ASC LIMIT 1')
    .bind(gid).first<{ char_id: number }>();
  if (!next) {
    await env.DB.prepare('DELETE FROM guilds WHERE id = ?').bind(gid).run();
    return { gid, disbanded: true };
  }
  if (rank === 2) {
    await env.DB.prepare('UPDATE guild_members SET rank = 2 WHERE char_id = ?').bind(next.char_id).run();
    await env.DB.prepare('UPDATE guilds SET leader_id = ? WHERE id = ?').bind(next.char_id, gid).run();
    return { gid, disbanded: false, newLeader: next.char_id };
  }
  return { gid, disbanded: false };
}

export async function setNotice(env: Env, gid: number, text: string): Promise<void> {
  await env.DB.prepare('UPDATE guilds SET notice = ? WHERE id = ?').bind(text.slice(0, 120), gid).run();
}

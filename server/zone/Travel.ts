import { ZONES } from '../../shared/data';
import { dist2 } from '../../shared/geom';
import { RAID, raidKey } from '../../shared/raid';
import { GUILD_COST, GUILD_MIN_LV } from '../../shared/social';
import type { ZoneDef } from '../../shared/types';
import type { Env } from '../env';
import type { PlayerSession } from './PlayerSession';

/** 포탈로 가려는 곳: 존 서버 이름(레이드는 파티 방)과 도착 위치. 갈 수 없으면 이유 */
export function portalTarget(zone: ZoneDef, p: PlayerSession, portalId: string): { key: string; id: string; x: number; z: number } | string | null {
  const portal = zone.portals.find((pt) => pt.id === portalId);
  if (!portal) return null;
  if (dist2(p.x, p.z, portal.x, portal.z) > (portal.r + 1.5) ** 2) return '포탈에서 너무 멉니다.';
  const dest = ZONES[portal.to];
  const arrive = dest?.portals.find((pt) => pt.id === portal.toPortal);
  if (!dest || !arrive) return null;
  let key = dest.id;
  if (dest.type === 'raid') {
    if (p.lv < RAID.minLevel) return `레이드는 레벨 ${RAID.minLevel}부터 들어갈 수 있습니다.`;
    key = raidKey(dest.id, p.party, p.id);
  }
  return { key, id: dest.id, x: arrive.exit[0], z: arrive.exit[1] };
}

/** 길드 관리인 앞에서 골드를 내고 길드 창설 */
export async function createGuildAt(env: Env, zone: ZoneDef | null, p: PlayerSession, name: string, save: (p: PlayerSession) => Promise<void>): Promise<void> {
  const npc = zone?.npcs.find((n) => n.role === 'guild' && dist2(p.x, p.z, n.x, n.z) <= 25);
  if (!npc) return p.send({ t: 'err', text: '길드 관리인 근처에서만 창설할 수 있습니다.' });
  if (p.lv < GUILD_MIN_LV) return p.send({ t: 'err', text: `레벨 ${GUILD_MIN_LV}부터 길드를 만들 수 있습니다.` });
  if (p.data.gold < GUILD_COST) return p.send({ t: 'err', text: `골드가 ${GUILD_COST.toLocaleString()} 필요합니다.` });
  const r = await env.SOCIAL.get(env.SOCIAL.idFromName('global')).createGuild(p.id, name);
  if (!r.ok) return p.send({ t: 'err', text: r.error ?? '창설에 실패했습니다.' });
  p.data.gold -= GUILD_COST;
  p.dirty = true;
  await save(p);
  p.send({ t: 'me', s: { gold: p.data.gold } });
}

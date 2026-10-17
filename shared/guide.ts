import { MONSTERS, ZONES } from './data';
import { ITEMS, LOOT } from './items';
import type { QuestDef } from './quests';
import type { PortalDef } from './types';

/** 길 안내 목표: 존과 그 안의 위치 */
export interface Goal {
  zone: string;
  x: number;
  z: number;
  label: string;
  /** 이만큼 가까워지면 도착 */
  near: number;
}

/** 지나갈 수 있는 존(레이드·탑·결투장은 목적지일 때만) */
const passable = (id: string) => ZONES[id]?.type === 'town' || ZONES[id]?.type === 'field';

/** from에서 to로 가는 길의 첫 포탈(같은 존이거나 길이 없으면 null) */
export function routeNext(from: string, to: string): PortalDef | null {
  if (from === to || !ZONES[from] || !ZONES[to]) return null;
  const prev = new Map<string, { zone: string; portal: PortalDef }>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of ZONES[cur].portals) {
      if (seen.has(p.to) || !ZONES[p.to]) continue;
      if (p.to !== to && !passable(p.to)) continue;
      seen.add(p.to);
      prev.set(p.to, { zone: cur, portal: p });
      if (p.to === to) {
        // 거꾸로 따라가 첫 포탈을 찾는다
        let z = to;
        while (prev.get(z)!.zone !== from) z = prev.get(z)!.zone;
        return prev.get(z)!.portal;
      }
      queue.push(p.to);
    }
  }
  return null;
}

/** 이 몬스터가 나오는 곳(사냥터 소환 구역 가운데) */
export function monsterGoal(id: string): Goal | null {
  for (const z of Object.values(ZONES)) {
    if (z.type !== 'field') continue;
    const s = z.spawns.find((sp) => sp.monster === id);
    if (s) return { zone: z.id, x: s.area.x, z: s.area.z, label: MONSTERS[id]?.name ?? id, near: Math.max(3, Math.min(s.area.w, s.area.d) / 3) };
  }
  return null;
}

/** 아이템을 얻는 곳: 떨어뜨리는 몬스터 또는 채집 노드 */
export function itemGoal(id: string): Goal | null {
  for (const [mon, list] of Object.entries(LOOT.drops)) {
    if (!list.some((d) => d.item === id) || MONSTERS[mon]?.boss) continue;
    const g = monsterGoal(mon);
    if (g) return { ...g, label: `${ITEMS[id]?.name ?? id} (${g.label})` };
  }
  const m = id.match(/^(ore|herb|wood)_(\d+)$/);
  if (m) {
    const tiers = (LOOT as unknown as { gather: { tiers: Record<string, number> } }).gather.tiers;
    for (const [zid, t] of Object.entries(tiers)) {
      if (t !== Number(m[2])) continue;
      const node = ZONES[zid]?.nodes.find((n) => n.kind === m[1]);
      if (node) return { zone: zid, x: node.x, z: node.z, label: `${ITEMS[id]?.name ?? id} 채집`, near: 2 };
    }
  }
  // 보스만 떨어뜨리는 재료
  for (const [mon, list] of Object.entries(LOOT.drops)) {
    if (list.some((d) => d.item === id)) {
      const g = monsterGoal(mon);
      if (g) return { ...g, label: `${ITEMS[id]?.name ?? id} (${g.label})` };
    }
  }
  return null;
}

/** NPC가 있는 곳 */
export function npcGoal(npcId: string): Goal | null {
  for (const z of Object.values(ZONES)) {
    const n = z.npcs.find((x) => x.id === npcId);
    if (n) return { zone: z.id, x: n.x, z: n.z + (Math.cos(n.f) > 0 ? 1.6 : -1.6), label: n.name, near: 2.2 };
  }
  return null;
}

/** 퀘스트의 다음 목표: 다 했으면 맡긴 NPC, 아니면 아직 못 채운 첫 목표 */
export function questGoal(q: QuestDef, progress: number[], complete: boolean): Goal | null {
  if (complete) return npcGoal(q.giver);
  const i = q.obj.findIndex((o, k) => progress[k] < o.n);
  const o = q.obj[i < 0 ? 0 : i];
  if (o.type === 'kill') return monsterGoal(o.target);
  if (o.type === 'collect') return itemGoal(o.target);
  const z = ZONES[o.target];
  return z ? { zone: z.id, x: z.spawn[0], z: z.spawn[1], label: z.name, near: 4 } : null;
}

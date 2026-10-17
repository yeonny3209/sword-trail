import { dist2 } from '../../shared/geom';
import { ITEMS, LOOT, makeItem, rollRarity } from '../../shared/items';
import { RECIPES } from '../../shared/quests';
import type { S2C } from '../../shared/protocol';
import type { ZoneDef } from '../../shared/types';
import { newUid } from '../db';
import { addItem, countItem, removeById, syncInv } from './Inventory';
import type { PlayerSession } from './PlayerSession';

interface GatherData { seconds: number; respawn: number; range: number; tiers: Record<string, number>; doubleChancePerLevel: number; expPerLevel: number }

/** 채집 노드(광석·약초·나무): 1.6초 채집하면 재료, 일정 시간 뒤 다시 생긴다 */
export class GatherSystem {
  private readonly g = (LOOT as unknown as { gather: GatherData }).gather;
  /** 노드 번호 → 다시 생기는 시각 */
  private readonly down = new Map<number, number>();

  constructor(private readonly zone: ZoneDef, private readonly broadcast: (m: S2C) => void) {}

  downList(): number[] {
    return [...this.down.keys()];
  }

  update(now: number): void {
    for (const [i, t] of this.down) {
      if (now >= t) {
        this.down.delete(i);
        this.broadcast({ t: 'node', i, up: true });
      }
    }
  }

  /** 채집할 수 없으면 이유, 되면 null */
  private blocked(p: PlayerSession, i: number): string | null {
    const n = this.zone.nodes[i];
    if (!n || p.dead) return '채집할 수 없습니다.';
    if (this.down.has(i)) return '이미 누군가 캐 갔습니다.';
    if (dist2(p.x, p.z, n.x, n.z) > (this.g.range + 0.6) ** 2) return '너무 멉니다.';
    return null;
  }

  onStart(p: PlayerSession, i: number): void {
    const why = this.blocked(p, i);
    if (why) return p.send({ t: 'err', text: why });
    p.gathering = { i, start: Date.now() };
  }

  onDone(p: PlayerSession, i: number): void {
    const g = p.gathering;
    p.gathering = null;
    if (!g || g.i !== i) return p.send({ t: 'err', text: '채집이 끊겼습니다.' });
    if (Date.now() - g.start < this.g.seconds * 1000 - 400) return p.send({ t: 'err', text: '채집이 너무 빨랐습니다.' });
    const why = this.blocked(p, i);
    if (why) return p.send({ t: 'err', text: why });
    const node = this.zone.nodes[i];
    this.down.set(i, Date.now() + this.g.respawn * 1000);
    this.broadcast({ t: 'node', i, up: false });
    const tier = this.g.tiers[this.zone.id] ?? 1;
    const id = `${node.kind}_${tier}`;
    const skill = p.data.gather;
    const n = 1 + (Math.random() < skill.lv * this.g.doubleChancePerLevel ? 1 : 0);
    addItem(p, makeItem(id, n, newUid()));
    skill.exp += 10;
    if (skill.exp >= skill.lv * this.g.expPerLevel) {
      skill.exp = 0;
      skill.lv++;
      p.send({ t: 'sys', text: `채집 숙련도 ${skill.lv}! 두 개를 얻을 확률이 올랐습니다.` });
    }
    p.dirty = true;
    p.send({ t: 'gathered', id, n, lv: skill.lv });
    p.achieve('gather');
    syncInv(p);
  }
}

/** 대장간 제작: 재료 + 골드 → 물약·강화석·장비(고급 이상) */
export function onCraft(p: PlayerSession, zone: ZoneDef, id: string): void {
  const smith = zone.npcs.find((n) => n.role === 'smith' && dist2(p.x, p.z, n.x, n.z) <= 4.5 * 4.5);
  const r = RECIPES[id];
  if (!smith || !r) return p.send({ t: 'err', text: '대장장이 근처에서만 제작할 수 있습니다.' });
  if (r.lv > p.lv) return p.send({ t: 'err', text: `레벨 ${r.lv}부터 만들 수 있습니다.` });
  if (p.data.gold < r.gold || r.need.some(([it, n]) => countItem(p, it) < n)) return p.send({ t: 'err', text: '재료나 골드가 부족합니다.' });
  const d = ITEMS[r.out];
  if (!d) return;
  const rar = d.kind === 'equip' ? Math.max(r.minRar ?? 0, rollRarity(Math.random(), 1)) : 0;
  const it = makeItem(r.out, r.n, newUid(), rar);
  // 가방 자리부터 확인(재료를 먼저 쓰면 잃을 수 있으므로)
  const free = LOOT.invSize - p.data.inv.length;
  if (free < 1 && !(d.stack && p.data.inv.some((s) => s.id === d.id && s.n + r.n <= d.stack!))) return p.send({ t: 'err', text: '가방이 가득 찼습니다.' });
  p.data.gold -= r.gold;
  for (const [mat, n] of r.need) removeById(p, mat, n);
  addItem(p, it);
  p.dirty = true;
  p.send({ t: 'crafted', id: r.out, n: r.n, rar });
  p.achieve('craft');
  syncInv(p);
  p.send({ t: 'me', s: { gold: p.data.gold } });
}

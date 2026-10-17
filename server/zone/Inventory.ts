import { dist2 } from '../../shared/geom';
import {
  cannotEquip, enhanceCost, enhanceRate, ITEMS, LOOT, makeItem, rollRarity, SHOPS, sellPrice, type Item, type Slot,
} from '../../shared/items';
import type { C2S } from '../../shared/protocol';
import type { MonsterDef, NpcDef, ZoneDef } from '../../shared/types';
import { newUid } from '../db';
import type { PlayerSession } from './PlayerSession';

const NPC_RANGE = 4.5;

export function syncInv(p: PlayerSession): void {
  p.send({ t: 'inv', inv: p.data.inv, equip: p.data.equip, gold: p.data.gold });
}

/** 능력치가 바뀌면 내 상태 전체를 다시 보낸다 */
function restat(p: PlayerSession): void {
  p.recalc();
  p.send({ t: 'me', s: p.self() });
}

/** 가방에 넣기(겹치는 것은 합침). 가득 차서 못 넣은 개수를 돌려준다 */
export function addItem(p: PlayerSession, it: Item): number {
  const d = ITEMS[it.id];
  if (!d) return it.n;
  const inv = p.data.inv;
  let left = it.n;
  if (d.stack) {
    for (const s of inv) {
      if (s.id !== it.id || left <= 0) continue;
      const room = d.stack - s.n;
      const put = Math.min(room, left);
      s.n += put;
      left -= put;
    }
  }
  while (left > 0 && inv.length < LOOT.invSize) {
    const put = d.stack ? Math.min(d.stack, left) : 1;
    inv.push(left === it.n && !d.stack ? it : { ...it, uid: newUid(), n: put });
    left -= put;
  }
  p.dirty = true;
  return left;
}

export function takeItem(p: PlayerSession, uid: string, n = 1): Item | null {
  const i = p.data.inv.findIndex((s) => s.uid === uid);
  if (i < 0) return null;
  const s = p.data.inv[i];
  if (s.n < n) return null;
  s.n -= n;
  if (s.n <= 0) p.data.inv.splice(i, 1);
  p.dirty = true;
  return { ...s, n };
}

/** 이 아이템들을 (removing을 뺀 뒤) 가방에 다 넣을 수 있나 */
export function canHold(p: PlayerSession, items: Item[], removing: { uid: string; n: number }[] = []): boolean {
  const bag = p.data.inv.map((s) => ({ ...s }));
  for (const r of removing) {
    const s = bag.find((x) => x.uid === r.uid);
    if (s) s.n -= r.n;
  }
  const inv = bag.filter((s) => s.n > 0);
  for (const it of items) {
    const d = ITEMS[it.id];
    if (!d) return false;
    let left = it.n;
    if (d.stack) {
      for (const s of inv) {
        if (s.id !== it.id) continue;
        const put = Math.min(d.stack - s.n, left);
        if (put > 0) {
          s.n += put;
          left -= put;
        }
      }
    }
    while (left > 0) {
      if (inv.length >= LOOT.invSize) return false;
      const put = d.stack ? Math.min(d.stack, left) : 1;
      inv.push({ ...it, n: put });
      left -= put;
    }
  }
  return true;
}

export function countItem(p: PlayerSession, id: string): number {
  return p.data.inv.filter((s) => s.id === id).reduce((a, s) => a + s.n, 0);
}

export function removeById(p: PlayerSession, id: string, n: number): void {
  for (const s of [...p.data.inv]) {
    if (s.id !== id || n <= 0) continue;
    const k = Math.min(n, s.n);
    takeItem(p, s.uid, k);
    n -= k;
  }
}

/** 처치 보상: 재료·물약 드랍표 + 낮은 확률로 장비(무작위 등급) */
export function rollLoot(p: PlayerSession, mon: MonsterDef): void {
  const got: { id: string; n: number; rar?: number }[] = [];
  for (const dr of LOOT.drops[mon.id] ?? []) {
    if (Math.random() < dr.chance) {
      const it = makeItem(dr.item, dr.n ?? 1, newUid());
      if (addItem(p, it) < it.n) got.push({ id: it.id, n: it.n });
    }
  }
  const chance = mon.boss ? LOOT.equipChance.boss : LOOT.equipChance.default * (1 + mon.lv * 0.04);
  if (Math.random() < chance) {
    // 몬스터 레벨 + 2까지의 장비, 무기는 내 직업 것이 더 잘 나온다
    const pool = Object.values(ITEMS).filter((d) => d.kind === 'equip' && d.lv <= mon.lv + 2 && (!d.cls || d.cls === p.cls || Math.random() < 0.25));
    const d = pool[Math.floor(Math.random() * pool.length)];
    if (d) {
      const rar = rollRarity(Math.random(), mon.boss ? 1.5 : 0);
      const it = makeItem(d.id, 1, newUid(), rar);
      if (addItem(p, it) === 0) got.push({ id: it.id, n: 1, rar });
      else p.send({ t: 'err', text: '가방이 가득 차서 장비를 줍지 못했습니다.' });
    }
  }
  if (got.length) {
    p.send({ t: 'loot', items: got });
    syncInv(p);
  }
}

/** 정예 처치 보상: 일반 드랍을 한 번 더 + 반드시 장비 하나(등급 보너스) + 강화석 */
export function eliteLoot(p: PlayerSession, mon: MonsterDef): void {
  rollLoot(p, mon);
  const pool = Object.values(ITEMS).filter((d) => d.kind === 'equip' && d.lv <= mon.lv + 3 && d.lv >= mon.lv - 8 && (!d.cls || d.cls === p.cls || Math.random() < 0.25));
  const d = pool[Math.floor(Math.random() * pool.length)];
  const got: { id: string; n: number; rar?: number }[] = [];
  if (d) {
    const rar = rollRarity(Math.random(), 1.2);
    const it = makeItem(d.id, 1, newUid(), rar);
    if (addItem(p, it) === 0) got.push({ id: it.id, n: 1, rar });
  }
  const stones = makeItem('enh_stone', 2 + Math.floor(Math.random() * 3), newUid());
  if (addItem(p, stones) < stones.n) got.push({ id: stones.id, n: stones.n });
  if (got.length) p.send({ t: 'loot', items: got });
  syncInv(p);
}

export function nearNpc(p: PlayerSession, zone: ZoneDef, role: NpcDef['role'], id?: string): NpcDef | null {
  return zone.npcs.find((n) => n.role === role && (!id || n.id === id) && dist2(p.x, p.z, n.x, n.z) <= NPC_RANGE * NPC_RANGE) ?? null;
}

export function onInventory(p: PlayerSession, m: C2S, zone: ZoneDef): void {
  switch (m.t) {
    case 'equip': return equip(p, m.uid);
    case 'unequip': return unequip(p, m.slot);
    case 'use': return use(p, m.uid);
    case 'pot': return potion(p, m.k);
    case 'buy': return buy(p, zone, m.npc, m.id, m.n);
    case 'sell': return sell(p, zone, m.uid, m.n);
    case 'enhance': return enhance(p, zone, m.uid);
    case 'discard': {
      const s = p.data.inv.find((x) => x.uid === m.uid);
      if (s) takeItem(p, s.uid, s.n);
      return syncInv(p);
    }
  }
}

function equip(p: PlayerSession, uid: string): void {
  const s = p.data.inv.find((x) => x.uid === uid);
  const d = s && ITEMS[s.id];
  if (!s || !d) return;
  const why = cannotEquip(p.cls, p.lv, d);
  if (why) return p.send({ t: 'err', text: why });
  const slot = d.slot!;
  p.data.inv = p.data.inv.filter((x) => x !== s);
  const old = p.data.equip[slot];
  p.data.equip[slot] = s;
  if (old) p.data.inv.push(old);
  p.dirty = true;
  syncInv(p);
  restat(p);
}

function unequip(p: PlayerSession, slot: Slot): void {
  const it = p.data.equip[slot];
  if (!it) return;
  if (p.data.inv.length >= LOOT.invSize) return p.send({ t: 'err', text: '가방이 가득 찼습니다.' });
  delete p.data.equip[slot];
  p.data.inv.push(it);
  p.dirty = true;
  syncInv(p);
  restat(p);
}

function drink(p: PlayerSession, s: Item): void {
  const d = ITEMS[s.id];
  if (!d?.heal || p.dead) return;
  const now = Date.now();
  if (now - p.lastPotAt < LOOT.potionCooldown * 1000) return;
  p.lastPotAt = now;
  takeItem(p, s.uid, 1);
  if (d.heal.hp) p.data.hp = Math.min(p.stats.mhp, p.data.hp + p.stats.mhp * d.heal.hp);
  if (d.heal.mp) p.data.mp = Math.min(p.stats.mmp, p.data.mp + p.stats.mmp * d.heal.mp);
  p.send({ t: 'me', s: { hp: Math.round(p.data.hp), mp: Math.round(p.data.mp) } });
  syncInv(p);
}

function use(p: PlayerSession, uid: string): void {
  const s = p.data.inv.find((x) => x.uid === uid);
  if (!s) return;
  if (ITEMS[s.id]?.kind === 'equip') return equip(p, uid);
  drink(p, s);
}

/** 가장 좋은(회복량 큰) 물약을 자동으로 쓴다 */
function potion(p: PlayerSession, k: 1 | 2): void {
  const key = k === 1 ? 'hp' : 'mp';
  const best = p.data.inv
    .filter((s) => ITEMS[s.id]?.heal?.[key] && (ITEMS[s.id].lv <= p.lv))
    .sort((a, b) => (ITEMS[b.id].heal![key] ?? 0) - (ITEMS[a.id].heal![key] ?? 0))[0];
  if (!best) return p.send({ t: 'err', text: k === 1 ? 'HP 물약이 없습니다.' : 'MP 물약이 없습니다.' });
  drink(p, best);
}

function buy(p: PlayerSession, zone: ZoneDef, npcId: string, id: string, n: number): void {
  const npc = nearNpc(p, zone, 'shop', npcId);
  const shop = npc?.ref ? SHOPS[npc.ref] : null;
  const d = ITEMS[id];
  n = Math.max(1, Math.min(99, n | 0));
  if (!shop || !d || !shop.items.includes(id)) return p.send({ t: 'err', text: '상점에서 멀리 있습니다.' });
  if (d.kind === 'equip') n = 1;
  const cost = d.price * n;
  if (p.data.gold < cost) return p.send({ t: 'err', text: '골드가 부족합니다.' });
  const it = makeItem(id, n, newUid(), 0, () => 0);
  const left = addItem(p, it);
  const bought = n - left;
  if (bought <= 0) return p.send({ t: 'err', text: '가방이 가득 찼습니다.' });
  p.data.gold -= d.price * bought;
  syncInv(p);
  p.send({ t: 'me', s: { gold: p.data.gold } });
}

function sell(p: PlayerSession, zone: ZoneDef, uid: string, n: number): void {
  if (!nearNpc(p, zone, 'shop')) return p.send({ t: 'err', text: '상인 근처에서만 팔 수 있습니다.' });
  const s = p.data.inv.find((x) => x.uid === uid);
  if (!s) return;
  n = Math.max(1, Math.min(s.n, n | 0));
  const got = takeItem(p, uid, n);
  if (!got) return;
  p.data.gold += sellPrice(got) * n;
  syncInv(p);
  p.send({ t: 'me', s: { gold: p.data.gold } });
}

/** 강화: 골드 + 강화석. 실패하면 +10부터는 한 단계 내려간다 */
function enhance(p: PlayerSession, zone: ZoneDef, uid: string): void {
  if (!nearNpc(p, zone, 'smith')) return p.send({ t: 'err', text: '대장장이 근처에서만 강화할 수 있습니다.' });
  const it = p.data.inv.find((x) => x.uid === uid) ?? Object.values(p.data.equip).find((x) => x?.uid === uid);
  const d = it && ITEMS[it.id];
  if (!it || !d || d.kind !== 'equip') return;
  const e = it.enh ?? 0;
  if (e >= LOOT.enhance.max) return p.send({ t: 'err', text: '최고 단계입니다.' });
  const cost = enhanceCost(it);
  if (p.data.gold < cost.gold || countItem(p, 'enh_stone') < cost.stones) return p.send({ t: 'err', text: '골드나 강화석이 부족합니다.' });
  p.data.gold -= cost.gold;
  removeById(p, 'enh_stone', cost.stones);
  const ok = Math.random() < enhanceRate(e);
  if (ok) it.enh = e + 1;
  else if (e >= LOOT.enhance.failDropFrom) it.enh = e - 1;
  p.dirty = true;
  p.send({ t: 'enh', ok, uid, enh: it.enh ?? 0 });
  syncInv(p);
  restat(p);
}

// 레이드 연기 테스트(로컬 서버 실행 중): node scripts/smoke-raid.mjs [주소] [raid1|raid2]
// 파티 둘이 레이드에 입장 → 같은 방·인원별 보스 체력 → 단계별 부하 소환 → 처치 보상 → 모두 나가면 방 초기화
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RATE = JSON.parse(readFileSync(new URL('../data/progression.json', import.meta.url), 'utf8')).monsterExpRate;

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
// 던전별 기대값
const DUNGEONS = {
  raid1: { portal: 'raid', gate: [[0, 33]], exitAt: [[0, 33.5]], boss: 'gargon', hp1: 60000, hp2: 105000, exp: 6500, gold: 400, phases: 2, adds: 'citadel_guard', addsTotal: 8 },
  raid2: { portal: 'raid2', gate: [[-33, 4], [-33, 0]], exitAt: [[0, 37.5]], boss: 'ignis', hp1: 140000, hp2: 245000, exp: 9500, gold: 800, phases: 3, adds: 'ember_cultist', addsTotal: 12 },
};
const ZONE = process.argv[3] ?? 'raid1';
const D = DUNGEONS[ZONE];
const rnd = Math.random().toString(36).slice(2, 7);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, token) {
  const res = await fetch(`${BASE}/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error}`);
  return data;
}

function sock(path, inbox) {
  const ws = new WebSocket(`${WS}${path}`);
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
  return new Promise((ok, bad) => {
    ws.addEventListener('open', () => ok(ws));
    ws.addEventListener('error', bad);
  });
}

async function player(tag, strong) {
  const { token } = await api('register', { name: `r${tag}${rnd}`, password: 'pass1234' });
  const name = `${tag}${rnd}`;
  const { id } = await api('characters', { name, cls: 'swordsman' }, token);
  if (strong) {
    // 레벨 40 + 힘·체력 몰빵: 보스를 금방 쓰러뜨리고 안 죽는 시험용 캐릭터
    execSync(`npx wrangler d1 execute sword-trail-online --local --command "UPDATE characters SET level=40, data=json_set(data,'$.alloc.str',3000,'$.alloc.vit',3000) WHERE id=${id}"`, { stdio: 'ignore' });
  }
  const p = { name, id, token, zin: [], sin: [], x: 0, z: 4 };
  p.connect = async () => {
    p.zin.length = 0;
    p.zone = await sock(`/ws?token=${token}&char=${id}`, p.zin);
  };
  await p.connect();
  p.social = await sock(`/social?token=${token}&char=${id}`, p.sin);
  p.send = (m) => p.zone.send(JSON.stringify(m));
  p.last = (t) => [...p.zin].reverse().find((m) => m.t === t);
  p.all = (t, f = () => true) => p.zin.filter((m) => m.t === t && f(m));
  return p;
}

async function walk(ps, path) {
  for (const [tx, tz] of path) {
    for (;;) {
      let done = true;
      for (const p of ps) {
        const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        if (d < 0.05) continue;
        done = false;
        const s = Math.min(0.9, d);
        p.x += (dx / d) * s;
        p.z += (dz / d) * s;
        p.send({ t: 'move', x: p.x, z: p.z, y: 0, f: 0, st: 1 });
      }
      if (done) break;
      await wait(110);
    }
  }
}

const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);

const a = await player('A', true);
const b = await player('B', true);
const weak = await player('C', false);
await wait(500);
a.social.send(JSON.stringify({ t: 'pinvite', name: b.name }));
await wait(300);
b.social.send(JSON.stringify({ t: 'preply', from: a.id, ok: true }));
await wait(500);

// 레벨이 모자라면 못 들어간다
await walk([weak], D.gate);
weak.send({ t: 'portal', id: D.portal });
await wait(500);
check('레벨 미달은 입장 불가', weak.all('err').some((m) => m.text.includes('레벨')));

// 파티가 레이드 포탈로 입장(한 명씩)
await walk([a, b], D.gate);
const enter = async (p) => {
  p.send({ t: 'portal', id: D.portal });
  await wait(900);
  p.zone.close();
  await p.connect();
  await wait(500);
};
await enter(a);
const wa = a.last('welcome');
check('레이드 입장', wa?.zone === ZONE, wa?.zone);
const bossA = wa?.monsters.find((m) => m.kind === D.boss);
check('혼자일 땐 기본 체력', bossA?.mhp === D.hp1, `${bossA?.mhp}`);
await enter(b);
const wb = b.last('welcome');
check('파티원은 같은 방', wb?.players.some((p) => p.id === a.id));
const bossB = wb?.monsters.find((m) => m.kind === D.boss);
check('둘이면 보스 체력 +75%', bossB?.mhp === D.hp2, `${bossB?.mhp}`);
check('먼저 있던 사람도 갱신', a.all('mspawn', (m) => m.m.kind === D.boss && m.m.mhp === D.hp2).length > 0);
a.x = b.x = wa.you.x;
a.z = b.z = wa.you.z;
b.x = a.x;
const bossId = bossB.id;

// 보스에게 다가가 때린다
let pos = [bossB.x, bossB.z];
const bossPos = () => {
  const s = [...a.zin].reverse().find((m) => m.t === 'snap' && m.m.some((r) => r[0] === bossId));
  const r = s?.m.find((r) => r[0] === bossId);
  if (r) pos = [r[1], r[2]];
  return pos;
};
let act = 1;
const t0 = Date.now();
let minions = 0, maxBanner = [];
while (!a.last('reward') && Date.now() - t0 < 150_000) {
  const [bx, bz] = bossPos();
  await walk([a, b], [[bx + 0.01, bz + 2.2]]);
  for (const p of [a, b]) {
    p.send({ t: 'act', a: 'sw_a1', f: Math.PI, i: act });
    p.send({ t: 'hit', i: act, h: 0, m: bossId });
    act++;
  }
  await wait(420);
}
await wait(800);
const banners = a.all('banner').map((m) => m.text);
check('보스가 깨어남 알림', banners.some((t) => t.includes('깨어났다')), banners.join(' | '));
check('1·2단계 알림', banners.filter((t) => t.includes('단계')).length === D.phases);
const adds = a.all('mspawn', (m) => m.m.kind === D.adds);
check(`단계마다 부하 소환(2명×2×${D.phases}단계)`, adds.length === D.addsTotal, `${adds.length}`);
check('보스 처치', a.all('mdie').some((m) => m.id === bossId));
check('레이드 클리어 알림', banners.some((t) => t.includes('클리어')));
for (const p of [a, b]) {
  const rw = p.last('reward');
  const loot = p.last('loot');
  check(`${p.name === a.name ? 'A' : 'B'} 보상: 경험치·골드`, rw?.exp === Math.round(D.exp * RATE) && rw.gold >= D.gold, JSON.stringify(rw));
  const hasEquip = loot?.items.some((i) => (i.rar ?? 0) >= 2);
  check(`${p.name === a.name ? 'A' : 'B'} 보상: 희귀 이상 장비 + 재료`, !!hasEquip && loot.items.length >= 3, JSON.stringify(loot?.items.map((i) => `${i.id}${i.rar ?? ''}`)));
}

// 나가기 → 모두 나가면 방이 초기화되어 새 보스가 나온다
for (const p of [a, b]) {
  await walk([p], D.exitAt);
  p.send({ t: 'portal', id: 'exit' });
  await wait(900);
}
a.zone.close();
await a.connect();
await wait(500);
check('나오면 마을', a.last('welcome')?.zone === 'town');
await walk([a], D.gate);
a.send({ t: 'portal', id: D.portal });
await wait(900);
a.zone.close();
await a.connect();
await wait(600);
const again = a.last('welcome')?.monsters.find((m) => m.kind === D.boss);
check('다시 들어가면 새 보스(체력 가득)', !!again && again.hp === again.mhp && again.hp === D.hp1, JSON.stringify(again && [again.hp, again.mhp]));

console.log(results.join('\n'));
for (const p of [a, b, weak]) {
  p.zone.close();
  p.social.close();
}
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

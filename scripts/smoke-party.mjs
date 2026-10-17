// 파티 경험치 연기 테스트: 두 명이 파티를 맺고 사냥터로 가서, 한 명이 슬라임을 잡으면 둘 다 경험치를 받는지
// 사용법(로컬 서버 실행 중): node scripts/smoke-party.mjs
const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
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

async function player(tag) {
  const { token } = await api('register', { name: `p${tag}${rnd}`, password: 'pass1234' });
  const name = `${tag}${rnd}`;
  const { id } = await api('characters', { name, cls: 'swordsman' }, token);
  const p = { name, id, token, zin: [], sin: [], x: 0, z: 4 };
  p.zone = await sock(`/ws?token=${token}&char=${id}`, p.zin);
  p.social = await sock(`/social?token=${token}&char=${id}`, p.sin);
  p.z_ = (m) => p.zone.send(JSON.stringify(m));
  p.s = (m) => p.social.send(JSON.stringify(m));
  p.move = (x, z) => {
    p.x = x;
    p.z = z;
    p.z_({ t: 'move', x, z, y: 0, f: 0, st: 1 });
  };
  return p;
}

/** 조금씩 걸어서 이동(서버 속도 검사 통과) */
async function walk(ps, tx, tz) {
  for (;;) {
    let done = true;
    for (const p of ps) {
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.05) continue;
      done = false;
      const s = Math.min(0.8, d);
      p.move(p.x + (dx / d) * s, p.z + (dz / d) * s);
    }
    if (done) return;
    await wait(110);
  }
}

const a = await player('A');
const b = await player('B');
await wait(300);
a.s({ t: 'pinvite', name: b.name });
await wait(300);
b.s({ t: 'preply', from: a.id, ok: true });
await wait(400);

// 마을 동쪽 포탈 → 바람 언덕
await walk([a, b], 33, 4);
await walk([a, b], 33.5, 0);
for (const p of [a, b]) p.z_({ t: 'portal', id: 'east' });
await wait(800);
for (const p of [a, b]) {
  p.zone.close();
  p.zin.length = 0;
  p.zone = await sock(`/ws?token=${p.token}&char=${p.id}`, p.zin);
}
await wait(600);
const w = a.zin.find((m) => m.t === 'welcome');
console.log('zone:', w?.zone, 'party in zone ok');
a.x = b.x = w.you.x;
a.z = b.z = w.you.z;
for (const p of [a, b]) p.s({ t: 'where', zone: w.zone, lv: 1 });

// 가장 가까운 슬라임을 쫓아가 기본 공격
const slimes = new Map(w.monsters.filter((m) => m.kind === 'slime').map((m) => [m.id, [m.x, m.z]]));
const pos = (id) => {
  const snap = [...a.zin].reverse().find((m) => m.t === 'snap' && m.m.some((r) => r[0] === id));
  const r = snap?.m.find((r) => r[0] === id);
  return r ? [r[1], r[2]] : slimes.get(id);
};
const target = [...slimes.keys()].sort((i, j) => Math.hypot(...pos(i).map((v, k) => v - [a.x, a.z][k])) - Math.hypot(...pos(j).map((v, k) => v - [a.x, a.z][k])))[0];
let act = 1;
const t0 = Date.now();
while (!a.zin.some((m) => m.t === 'reward') && Date.now() - t0 < 40_000) {
  const [mx, mz] = pos(target);
  const d = Math.hypot(mx - a.x, mz - a.z);
  if (d > 1.6) {
    const s = Math.min(0.8, d - 1.2);
    a.move(a.x + ((mx - a.x) / d) * s, a.z + ((mz - a.z) / d) * s);
    b.move(a.x - 2, a.z);
    await wait(110);
    continue;
  }
  a.z_({ t: 'act', a: 'sw_a1', f: Math.atan2(mx - a.x, mz - a.z), i: act });
  await wait(90);
  a.z_({ t: 'hit', i: act, h: 0, m: target });
  act++;
  await wait(500);
}
await wait(300);
const ra = a.zin.filter((m) => m.t === 'reward');
const rb = b.zin.filter((m) => m.t === 'reward');
console.log('A reward:', JSON.stringify(ra), '\nB reward:', JSON.stringify(rb));
// 경험치는 나누고(같은 값), 골드·드랍은 파티원 각자 따로 받는다
const ok = ra.length > 0 && rb.length > 0 && rb[0].exp > 0 && rb[0].exp === ra[0].exp && rb[0].gold > 0;
console.log(ok ? 'PASS 파티 경험치 나눔·각자 골드' : 'FAIL 파티 경험치 나눔·각자 골드');
for (const p of [a, b]) {
  p.zone.close();
  p.social.close();
}
process.exit(ok ? 0 : 1);

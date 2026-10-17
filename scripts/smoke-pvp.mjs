// 결투장 PvP 연기 테스트(로컬 서버 실행 중): node scripts/smoke-pvp.mjs
// 두 명이 결투장에 들어가 서로 때리고, 피격 확인·피해·처치 점수·부활·무적·파티 예외를 확인한다
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

function sock(path, inbox, onMsg) {
  const ws = new WebSocket(`${WS}${path}`);
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    inbox.push(m);
    onMsg?.(m);
  });
  return new Promise((ok, bad) => {
    ws.addEventListener('open', () => ok(ws));
    ws.addEventListener('error', bad);
  });
}

async function player(tag) {
  const { token } = await api('register', { name: `v${tag}${rnd}`, password: 'pass1234' });
  const name = `${tag}${rnd}`;
  const { id } = await api('characters', { name, cls: 'swordsman' }, token);
  const p = { name, id, token, zin: [], sin: [], x: 0, z: 4, autoHurt: true };
  p.onMsg = (m) => {
    // 맞았다는 알림을 받으면 곧바로 확인(무적이 아닌 클라이언트처럼)
    if (m.t === 'phit' && p.autoHurt) p.send({ t: 'phurt', k: m.k });
  };
  p.zone = await sock(`/ws?token=${token}&char=${id}`, p.zin, p.onMsg);
  p.social = await sock(`/social?token=${token}&char=${id}`, p.sin);
  p.send = (m) => p.zone.send(JSON.stringify(m));
  p.last = (t) => [...p.zin].reverse().find((m) => m.t === t);
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
        const s = Math.min(0.8, d);
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

const a = await player('A');
const b = await player('B');
await wait(400);

// 마을에서는 PvP가 안 된다
let act = 1;
const swing = (p, target) => {
  p.send({ t: 'act', a: 'sw_a1', f: 0, i: act });
  p.send({ t: 'phit', i: act, h: 0, p: target.id });
  act++;
};
swing(a, b);
await wait(400);
check('마을에서는 PvP 없음', !b.last('phit'));

// 북쪽 문 → 결투장
await walk([a, b], [[3, 4], [3, -30], [0, -33.2]]);
for (const p of [a, b]) p.send({ t: 'portal', id: 'north' });
await wait(800);
for (const p of [a, b]) {
  p.zone.close();
  p.zin.length = 0;
  p.zone = await sock(`/ws?token=${p.token}&char=${p.id}`, p.zin, p.onMsg);
}
await wait(600);
const w = a.last('welcome');
check('결투장 입장', w?.zone === 'arena', w?.zone);
for (const p of [a, b]) {
  p.x = w.you.x;
  p.z = w.you.z;
}
await walk([b], [[b.x, b.z - 1]]);
const hp0 = b.last('welcome').you.hp;

swing(a, b);
await wait(500);
const dm = a.zin.find((m) => m.t === 'dmg' && m.tk === 'p' && m.id === b.id);
check('맞히면 상대에게 알림 → 확인 → 피해', !!b.last('phit') && !!dm && dm.pvp === true, dm && `피해 ${dm.n}`);
check('상대 체력 감소', (b.last('me')?.s.hp ?? hp0) < hp0);

// 확인하지 않으면(무적·회피) 피해 없음
b.autoHurt = false;
const nDmg = a.zin.filter((m) => m.t === 'dmg' && m.tk === 'p').length;
swing(a, b);
await wait(500);
check('확인 안 하면 피해 없음', a.zin.filter((m) => m.t === 'dmg' && m.tk === 'p').length === nDmg);
b.autoHurt = true;

// 백스텝 무적 중에는 알림 자체가 없다
const nHit = b.zin.filter((m) => m.t === 'phit').length;
b.send({ t: 'act', a: 'sw_back', f: 0, i: 9001 });
await wait(60);
swing(a, b);
await wait(400);
check('백스텝 무적', b.zin.filter((m) => m.t === 'phit').length === nHit);
await wait(600);

// 처치까지
const t0 = Date.now();
while (!b.last('died') && Date.now() - t0 < 30_000) {
  swing(a, b);
  await wait(420);
}
await wait(400);
check('쓰러짐(부활 대기 3초)', b.last('died')?.wait === 3);
const pa = a.last('pvp'), pb = b.last('pvp');
check('처치 점수', pa?.delta === 12 && pa.me.k === 1 && pa.me.r === 1012, JSON.stringify(pa));
check('쓰러짐 기록', pb?.delta === -12 && pb.me.d === 1 && pb.me.r === 988, JSON.stringify(pb));
check('처치 알림', a.zin.some((m) => m.t === 'sys' && m.text.includes('쓰러뜨렸습니다')));
await wait(3000);
b.send({ t: 'revive' });
await wait(500);
const mhp = b.last('welcome').you.mhp;
check('결투장 부활은 체력 가득', b.zin.some((m) => m.t === 'me' && m.s.hp === mhp));

// 같은 상대 반복 처치는 점수 없음 → 생략(시간이 오래 걸림). 파티원은 때릴 수 없다
a.social.send(JSON.stringify({ t: 'pinvite', name: b.name }));
await wait(300);
b.social.send(JSON.stringify({ t: 'preply', from: a.id, ok: true }));
await wait(500);
const nHit2 = b.zin.filter((m) => m.t === 'phit').length;
await walk([b], [[a.x, a.z - 1]]);
swing(a, b);
await wait(400);
check('파티원은 공격 안 됨', b.zin.filter((m) => m.t === 'phit').length === nHit2);

// 순위표
a.send({ t: 'pvprank' });
await wait(1500);
const rank = a.last('pvprank');
check('순위표', !!rank && rank.me.k === 1 && Array.isArray(rank.top), JSON.stringify(rank?.top?.slice(0, 2)));

console.log(results.join('\n'));
for (const p of [a, b]) {
  p.zone.close();
  p.social.close();
}
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

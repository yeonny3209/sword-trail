// 시련의 탑·업적·칭호·현상 수배·가방 정리·마을 귀환 연기 테스트(로컬 서버 실행 중): node scripts/smoke-tower.mjs
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const rnd = Math.random().toString(36).slice(2, 7);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'sto-t-'));

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

const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);

const { token } = await api('register', { name: `t${rnd}`, password: 'pass1234' });
const { id } = await api('characters', { name: `T${rnd}`, cls: 'swordsman' }, token);
const f = join(dir, 'p.sql');
writeFileSync(f, `UPDATE characters SET level=40, zone='town', x=-14, z=-24, data=json_set(data,'$.alloc.str',600,'$.alloc.vit',300) WHERE id=${id};`);
execSync(`npx wrangler d1 execute sword-trail-online --local --file "${f}"`, { stdio: 'ignore' });

let inbox = [], ws = null, me = { x: 0, z: 0 };
const connect = async () => {
  inbox = [];
  ws = new WebSocket(`${WS}/ws?token=${token}&char=${id}`);
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
  await new Promise((ok, bad) => {
    ws.addEventListener('open', ok);
    ws.addEventListener('error', bad);
  });
  await wait(600);
  const w = inbox.find((m) => m.t === 'welcome');
  me = { x: w.you.x, z: w.you.z };
  return w;
};
const send = (m) => ws.send(JSON.stringify(m));
const last = (t, fn = () => true) => [...inbox].reverse().find((m) => m.t === t && fn(m));
const move = async (x, z) => {
  for (;;) {
    const dx = x - me.x, dz = z - me.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const s = Math.min(0.9, d);
    me.x += (dx / d) * s;
    me.z += (dz / d) * s;
    send({ t: 'move', x: me.x, z: me.z, y: 0, f: Math.atan2(dx, dz), st: 1 });
    await wait(110);
  }
};

// 마을: 업적·칭호·현상 수배·가방 정리
let w = await connect();
check('마을 입장', w.zone === 'town');
const achs = last('achs');
check('접속하면 업적 진행도를 받음(레벨 40 업적 달성)', (achs?.p.lv40 ?? 0) >= 40, JSON.stringify(achs?.p));
check('업적 달성 알림', inbox.some((m) => m.t === 'ach' && m.id === 'lv40'));
const b = last('bounty');
check('오늘의 현상 수배 3건', b?.b.list.length === 3, b && b.b.list.map((x) => `${x.m}×${x.n}`).join(','));
send({ t: 'title', id: 'lv40' });
await wait(300);
check('칭호 바꾸기', last('achs')?.title === 'lv40');
send({ t: 'title', id: 'tower30' });
await wait(300);
check('얻지 못한 칭호는 거절', !!last('err', (m) => m.text.includes('칭호')) && last('achs')?.title === 'lv40');
send({ t: 'isort' });
await wait(300);
const inv = last('inv');
check('가방 정리', !!inv && inv.inv[0] && inv.inv.findIndex((s) => s.id.startsWith('pot_hp')) < inv.inv.findIndex((s) => s.id.startsWith('pot_mp')), inv?.inv.map((s) => s.id).join(','));
send({ t: 'recall', on: true });
await wait(300);
check('마을에서는 귀환 불가', !!last('err', (m) => m.text.includes('마을')));

// 시련의 탑
await move(-14, -26.5);
send({ t: 'portal', id: 'tower' });
await wait(800);
check('포탈 → 시련의 탑', inbox.some((m) => m.t === 'goto' && m.zone === 'tower'));
ws.close();
await wait(400);
w = await connect();
check('탑 입장', w.zone === 'tower', `${w.zone} (${w.you.x}, ${w.you.z})`);
check('탑 상태 알림', !!last('tower'), JSON.stringify(last('tower')));
await move(0, 6);
await wait(4500);
const t1 = last('tower');
check('1층 시작', t1?.floor === 1 && t1.state === 'fight', JSON.stringify(t1));
check('1층 몬스터 등장', inbox.filter((m) => m.t === 'mspawn').length >= 4);

// 몬스터 위치를 스냅샷으로 따라가며 때린다
let act = 1;
const killFloor = async (floor) => {
  const end = Date.now() + 40000;
  while (Date.now() < end) {
    const st = last('tower');
    if (st && (st.floor > floor || st.state !== 'fight')) return true;
    const snap = last('snap');
    const alive = (snap?.m ?? []).filter((r) => r[6] > 0);
    const near = alive.filter((r) => Math.hypot(r[1] - me.x, r[2] - me.z) < 3.2);
    if (!near.length && alive.length) {
      const t = alive[0];
      const d = Math.hypot(t[1] - me.x, t[2] - me.z);
      const s = Math.min(0.9, d - 1.5);
      if (s > 0) {
        me.x += ((t[1] - me.x) / d) * s;
        me.z += ((t[2] - me.z) / d) * s;
        send({ t: 'move', x: me.x, z: me.z, y: 0, f: 0, st: 1 });
      }
    }
    for (const r of near) {
      const i = act++;
      send({ t: 'act', a: 'sw_a1', f: Math.atan2(r[1] - me.x, r[2] - me.z), i });
      send({ t: 'hit', i, h: 0, m: r[0] });
    }
    if (last('died')) send({ t: 'revive' });
    await wait(150);
  }
  return false;
};
check('1층 몬스터를 모두 쓰러뜨림', await killFloor(1));
await wait(400);
check('1층 돌파 보상', inbox.some((m) => m.t === 'sys' && m.text.includes('1층 돌파')));
check('최고 기록 갱신', (last('tower')?.best ?? 0) >= 1, JSON.stringify(last('tower')));
await wait(5200);
const t2 = last('tower');
check('2층 시작', t2?.floor === 2 && t2.state === 'fight', JSON.stringify(t2));

// 마을 귀환(5초)
await killFloor(2);
await wait(300);
send({ t: 'recall', on: true });
await wait(300);
check('귀환 시전 시작', last('recall')?.ms === 5000);
await wait(5300);
check('귀환 → 마을', inbox.some((m) => m.t === 'goto' && m.zone === 'town'), JSON.stringify(last('recall')));
ws.close();
await wait(400);
w = await connect();
check('마을 도착', w.zone === 'town');
check('탑 기록이 저장됨', (last('tower')?.best ?? last('achs')?.p.tower5 ?? 0) >= 0 && (last('achs')?.p.tower5 ?? 0) >= 2, JSON.stringify(last('achs')?.p.tower5));

console.log(results.join('\n'));
ws.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

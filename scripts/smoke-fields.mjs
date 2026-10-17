// 후반 사냥터 연기 테스트(로컬 서버 실행 중): node scripts/smoke-fields.mjs
// 정상 사원(field4) → 잿빛 협곡(field5) → 서리 고원(field6) 포탈 이동, 몬스터·채집 노드 구성
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const rnd = Math.random().toString(36).slice(2, 7);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'sto-f-'));

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

const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);

const { token } = await api('register', { name: `f${rnd}`, password: 'pass1234' });
const { id } = await api('characters', { name: `F${rnd}`, cls: 'swordsman' }, token);
// 이전 접속이 끊길 때 자동 저장이 위치를 덮어쓰지 않도록, 먼저 끊고 기다린 뒤 바꾼다
let inbox = [], ws = null;
const place = async (zone, x, z) => {
  ws?.close();
  ws = null;
  await wait(900);
  const f = join(dir, 'p.sql');
  writeFileSync(f, `UPDATE characters SET level=40, zone='${zone}', x=${x}, z=${z} WHERE id=${id};`);
  execSync(`npx wrangler d1 execute sword-trail-online --local --file "${f}"`, { stdio: 'ignore' });
};
const connect = async () => {
  ws?.close();
  inbox = [];
  ws = await sock(`/ws?token=${token}&char=${id}`, inbox);
  await wait(500);
  return inbox.find((m) => m.t === 'welcome');
};
const send = (m) => ws.send(JSON.stringify(m));
const kinds = (w) => [...new Set(w.monsters.map((m) => m.kind))].sort();

// 정상 사원 북쪽 포탈
await place('field4', -42, -48);
let w = await connect();
check('정상 사원 입장', w.zone === 'field4');
send({ t: 'move', x: -42, z: -50.2, y: 0, f: 0, st: 1 });
await wait(150);
send({ t: 'portal', id: 'north' });
await wait(800);
check('북쪽 포탈 → 잿빛 협곡', inbox.some((m) => m.t === 'goto' && m.zone === 'field5'));
w = await connect();
check('잿빛 협곡 도착(남쪽 포탈 근처)', w.zone === 'field5' && Math.abs(w.you.x + 42) < 3 && w.you.z > 45, `${w.zone} (${w.you.x}, ${w.you.z})`);
check('잿빛 협곡 몬스터 구성', JSON.stringify(kinds(w)) === JSON.stringify(['ash_wolf', 'barga', 'canyon_raider', 'ember_mage', 'magma_slime', 'rock_titan']), kinds(w).join(','));
const boss5 = w.monsters.find((m) => m.kind === 'barga');
check('필드 보스 바르가', boss5?.mhp === 64000, `${boss5?.mhp}`);
check('채집 노드', inbox.some((m) => m.t === 'nodes'));

// 협곡 북쪽 포탈 → 서리 고원
await place('field5', 42, -49);
w = await connect();
send({ t: 'move', x: 42, z: -50.4, y: 0, f: 0, st: 1 });
await wait(150);
send({ t: 'portal', id: 'north' });
await wait(800);
check('북쪽 포탈 → 서리 고원', inbox.some((m) => m.t === 'goto' && m.zone === 'field6'));
w = await connect();
check('서리 고원 도착', w.zone === 'field6' && w.you.z > 45, `${w.zone} (${w.you.x}, ${w.you.z})`);
check('서리 고원 몬스터 구성', JSON.stringify(kinds(w)) === JSON.stringify(['frost_knight', 'frost_wolf', 'ice_archer', 'siryen', 'snow_wisp', 'yeti']), kinds(w).join(','));
const boss6 = w.monsters.find((m) => m.kind === 'siryen');
check('필드 보스 시리엔', boss6?.mhp === 98000, `${boss6?.mhp}`);

// 되돌아가기
send({ t: 'move', x: 42, z: 52, y: 0, f: 0, st: 1 });
await wait(150);
send({ t: 'portal', id: 'south' });
await wait(800);
check('남쪽 포탈 → 잿빛 협곡', inbox.some((m) => m.t === 'goto' && m.zone === 'field5'));

console.log(results.join('\n'));
ws.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

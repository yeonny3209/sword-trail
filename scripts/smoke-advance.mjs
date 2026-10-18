// 전직·스킬 강화·룬 소켓·세트 효과 연기 테스트(로컬 서버 실행 중): node scripts/smoke-advance.mjs
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const rnd = Math.random().toString(36).slice(2, 7);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'sto-a-'));

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

const { token } = await api('register', { name: `a${rnd}`, password: 'pass1234' });
const { id } = await api('characters', { name: `A${rnd}`, cls: 'swordsman' }, token);

// 전직 교관(-9, 12) 근처 마을, 레벨 40, 골드 넉넉, 룬 달린 희귀 장비와 룬 여러 개
const gear = (uid, itemId, rar, sock = []) => ({ uid, id: itemId, n: 1, rar, opt: {}, enh: 0, ...(sock.length ? { sock } : {}) });
const inv = [
  gear('g1', 'armor_5', 2),
  gear('g2', 'helmet_5', 1),
  gear('g3', 'gloves_5', 0),
  { uid: 'r1', id: 'rune_ruby_2', n: 3 },
  { uid: 'r2', id: 'rune_blood_3', n: 1 },
  { uid: 'r3', id: 'rune_swift_3', n: 1 },
  { uid: 'pot', id: 'pot_hp_s', n: 5 },
];
const equip = { weapon: gear('gw', 'w_swordsman_5', 2), boots: gear('gb', 'boots_5', 1), ring: gear('gr', 'ring_5', 0), necklace: gear('gn', 'necklace_5', 0) };
const sql = `UPDATE characters SET level=40, zone='town', x=-20, z=-8, data=json_set(data,'$.gold',500000,'$.skillPoints',20,'$.alloc.str',300,'$.alloc.vit',200,'$.inv',json('${JSON.stringify(inv)}'),'$.equip',json('${JSON.stringify(equip)}'),'$.skills.sw_upper',5,'$.skills.sw_quake',3) WHERE id=${id};`;
const f = join(dir, 'p.sql');
writeFileSync(f, sql);
execSync(`npx wrangler d1 execute sword-trail-online --local --file "${f}"`, { stdio: 'ignore' });

let inbox = [], ws = null;
const connect = async () => {
  ws?.close();
  inbox = [];
  ws = new WebSocket(`${WS}/ws?token=${token}&char=${id}`);
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
  await new Promise((ok, bad) => {
    ws.addEventListener('open', ok);
    ws.addEventListener('error', bad);
  });
  await wait(600);
  return inbox.find((m) => m.t === 'welcome');
};
const send = (m) => ws.send(JSON.stringify(m));
const last = (t, fn = () => true) => [...inbox].reverse().find((m) => m.t === t && fn(m));
const me = () => Object.assign({}, inbox.find((m) => m.t === 'welcome').you, ...inbox.filter((m) => m.t === 'me').map((m) => m.s));
const invNow = () => last('inv');
const findGear = (uid) => invNow().inv.find((x) => x.uid === uid) ?? Object.values(invNow().equip).find((x) => x?.uid === uid);

let w = await connect();
let you = w.you;
check('접속: 세트 5단계 3부위(검의 유산 무기·장화·반지·목걸이 4부위)', you.fx && you.fx.mpOnKill === 0.02, JSON.stringify(you.fx));
const atk0 = you.atk;

// ---- 스킬 강화 ----
const g0 = me().gold;
send({ t: 'senh', a: 'sw_quake', k: 'wide' });
await wait(300);
check('스킬 강화(광역) 적용·골드 차감', me().senh?.sw_quake === 'wide' && g0 - me().gold === 6750, `${JSON.stringify(me().senh)} gold ${me().gold}`);
send({ t: 'senh', a: 'sw_upper', k: 'bogus' });
await wait(200);
check('잘못된 강화 종류는 무시', me().senh?.sw_upper === undefined);
send({ t: 'senh', a: 'sw_rush', k: 'pow' });
await wait(300);
check('배우지 않은(레벨 3 미만) 스킬은 강화 불가', !!last('err', (m) => m.text.includes('레벨')) && me().senh?.sw_rush === undefined);
send({ t: 'senh', a: 'sw_quake', k: '' });
await wait(300);
check('강화 해제', me().senh?.sw_quake === undefined);

// ---- 룬 소켓 ----
send({ t: 'socket', uid: 'gw', i: 0, rune: 'r1' });
await wait(300);
let g1 = findGear('gw');
check('룬 끼우기(희귀 장비 소켓 0)', g1?.sock?.[0] === 'rune_ruby_2', JSON.stringify(g1?.sock));
check('룬 하나 소모', invNow().inv.find((x) => x.uid === 'r1')?.n === 2);
check('공격력 증가(장착한 장비의 룬)', me().atk > atk0, `${atk0} → ${me().atk}`);
send({ t: 'socket', uid: 'gw', i: 2, rune: 'r1' });
await wait(300);
check('없는 소켓(희귀는 2칸)은 거절', !!last('err', (m) => m.text.includes('소켓')));
send({ t: 'socket', uid: 'g3', i: 0, rune: 'r1' });
await wait(300);
check('일반 장비는 소켓이 없음', !invNow().inv.find((x) => x.uid === 'g3')?.sock?.length);
send({ t: 'socket', uid: 'gw', i: 1, rune: 'r3' });
send({ t: 'socket', uid: 'gb', i: 0, rune: 'r2' });
await wait(500);
check('신속 룬으로 재사용 시간 감소', (me().fx?.cdr ?? 0) >= 0.03, JSON.stringify(me().fx));
check('흡혈 룬으로 피해 흡수', (me().fx?.leech ?? 0) >= 0.03, JSON.stringify(me().fx));
send({ t: 'unsocket', uid: 'gw', i: 0 });
await wait(300);
g1 = findGear('gw');
check('룬 빼기(룬은 부서짐)', !g1.sock?.[0] && g1.sock?.[1] === 'rune_swift_3');
// 전직 교관 앞으로(DB에서 위치만 옮기고 다시 접속)
ws.close();
await wait(900);
execSync(`npx wrangler d1 execute sword-trail-online --local --command "UPDATE characters SET x=-9, z=14 WHERE id=${id};"`, { stdio: 'ignore' });
await connect();

// ---- 전직 ----
send({ t: 'branch', id: 'db_reaper' });
await wait(300);
check('다른 직업의 갈래는 거절', !me().branch);
send({ t: 'branch', id: 'sw_blade' });
await wait(500);
check('전직: 검성', me().branch === 'sw_blade', `${me().branch} err ${JSON.stringify(last('err'))}`);
check('전직 보상: 스킬 포인트 +4', me().skillPoints === 24, `${me().skillPoints}`);
check('전직 보너스: 치명타 피해', (me().fx?.critDmg ?? 0) >= 0.2, JSON.stringify(me().fx));
check('전직 알림 배너', !!last('banner', (m) => m.text.includes('검성')));
const goldAfter = me().gold;
send({ t: 'branch', id: 'sw_paladin' });
await wait(400);
check('갈래 바꾸기(더 비쌈)·포인트는 한 번만', me().branch === 'sw_paladin' && goldAfter - me().gold === 40000 && me().skillPoints === 24, `${goldAfter - me().gold} ${me().skillPoints}`);
send({ t: 'branch', id: 'sw_blade' });
await wait(400);

// ---- 전직 스킬 ----
send({ t: 'skill', a: 'sw_b1b' });
await wait(300);
check('전직 스킬 배우기(레벨 34 요구)', me().skills.sw_b1b === 1, JSON.stringify(me().skills));
send({ t: 'skill', a: 'sw_b2a' });
await wait(300);
check('다른 갈래의 스킬은 못 배움', !me().skills.sw_b2a);
const mp0 = me().mp;
send({ t: 'act', a: 'sw_b1b', f: 0, i: 1 });
await wait(300);
check('전직 스킬 사용: MP 소모·쿨타임', me().mp < mp0 && !last('cdfail'), `${mp0} → ${me().mp}`);
send({ t: 'act', a: 'sw_b2b', f: 0, i: 2 });
await wait(300);
check('다른 갈래의 스킬은 사용 불가', !!last('cdfail', (m) => m.a === 'sw_b2b'));

// ---- 초기화·재접속 ----
ws.close();
await wait(900);
w = await connect();
you = w.you;
check('재접속 후에도 전직·강화·룬 유지', you.branch === 'sw_blade' && Object.keys(you.senh ?? {}).length === 0 && findGear('gw')?.sock?.[1] === 'rune_swift_3');
send({ t: 'reset' });
await wait(400);
check('초기화: 전직 보너스 포인트 포함', me().skillPoints === 39 + 4, `${me().skillPoints}`);

console.log(results.join('\n'));
ws.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

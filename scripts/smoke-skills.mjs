// 스킬 효과 연기 테스트(로컬 서버 실행 중): node scripts/smoke-skills.mjs
// 신관(치유·버프·보호막·소생), 주술사(디버프·독·속박), 파티 결속, 파티원 살리기
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const rnd = Math.random().toString(36).slice(2, 7);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'sto-'));

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

/** 레벨 40, 스킬 전부 3레벨로 배운 시험 캐릭터. hp 지정 가능 */
async function player(tag, cls, skills, hp, at) {
  const { token } = await api('register', { name: `k${tag}${rnd}`, password: 'pass1234' });
  const name = `${tag}${rnd}`;
  const { id } = await api('characters', { name, cls }, token);
  const sk = JSON.stringify(Object.fromEntries(skills.map((s) => [s, 3]))).replace(/'/g, "''");
  const sql = `UPDATE characters SET level=40, data=json_set(data,'$.skills',json('${sk}'),'$.skillPoints',0,'$.alloc.int',400,'$.alloc.vit',200${hp !== undefined ? `,'$.hp',${hp}` : ''}) WHERE id=${id};${at ? ` UPDATE characters SET zone='${at[0]}', x=${at[1]}, z=${at[2]} WHERE id=${id};` : ''}`;
  const f = join(dir, `${tag}.sql`);
  writeFileSync(f, sql);
  execSync(`npx wrangler d1 execute sword-trail-online --local --file "${f}"`, { stdio: 'ignore' });
  const p = { name, id, token, cls, zin: [], sin: [], x: 0, z: 4, f: 0, act: 1 };
  p.connect = async () => {
    p.zin.length = 0;
    p.zone = await sock(`/ws?token=${token}&char=${id}`, p.zin);
    p.zone.addEventListener('close', (e) => process.env.DEBUG && console.log(`[${p.cls}] 존 연결 닫힘`, e.code, e.reason));
  };
  await p.connect();
  p.social = await sock(`/social?token=${token}&char=${id}`, p.sin);
  p.send = (m) => p.zone.send(JSON.stringify(m));
  p.last = (t, f = () => true) => [...p.zin].reverse().find((m) => m.t === t && f(m));
  p.all = (t, f = () => true) => p.zin.filter((m) => m.t === t && f(m));
  p.move = (x, z, f = p.f) => {
    p.x = x; p.z = z; p.f = f;
    p.send({ t: 'move', x, z, y: 0, f, st: 1 });
  };
  p.cast = async (a, wait_ms = 900) => {
    p.send({ t: 'act', a, f: p.f, i: p.act++ });
    await wait(wait_ms);
  };
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
        p.move(p.x + (dx / d) * s, p.z + (dz / d) * s, Math.atan2(dx, dz));
      }
      if (done) break;
      await wait(110);
    }
  }
}

const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);

const BF = ['bf_heal', 'bf_smite', 'bf_bless', 'bf_aegis', 'bf_regen', 'bf_ult', 'bf_mana', 'bf_lance', 'bf_raise', 'bf_shield'];
const DB = ['db_curse', 'db_hex', 'db_miasma', 'db_mark', 'db_chain', 'db_ult', 'db_drain', 'db_corrode', 'db_shadow', 'db_blast'];
const A = await player('A', 'buffer', BF);
const B = await player('B', 'swordsman', ['sw_upper'], 40);
const C = await player('C', 'debuffer', DB);
const D = await player('D', 'swordsman', ['sw_upper'], 0, ['field1', -43.5, 0]);
const E = await player('E', 'swordsman', ['sw_upper'], 0, ['field1', -30, 12]);
await wait(500);
// 파티는 최대 4명: 신관 A, 검사 B, 쓰러진 D·E (주술사 C는 따로 — 디버프 시험용)
for (const m of [B, D, E]) {
  A.social.send(JSON.stringify({ t: 'pinvite', name: m.name }));
  await wait(250);
  m.social.send(JSON.stringify({ t: 'preply', from: A.id, ok: true }));
  await wait(250);
}
await wait(400);

// 사냥터로
await walk([A, B, C], [[3, 4], [33, 4], [33.5, 0]]);
for (const p of [A, B, C]) {
  p.send({ t: 'portal', id: 'east' });
}
await wait(900);
for (const p of [A, B, C]) {
  p.zone.close();
  await p.connect();
}
E.zone.close();
await E.connect();
E.x = -30;
E.z = 12;
await wait(700);
const w = A.last('welcome');
check('사냥터 입장', w?.zone === 'field1');
for (const p of [A, B, C]) {
  p.x = w.you.x + 0.3 * [A, B, C].indexOf(p);
  p.z = w.you.z;
}
D.x = -43.5;
D.z = 0;
check('쓰러진 채 들어온 파티원은 누워 있음', D.last('died')?.wait === 0 || A.last('snap')?.p.some((r) => r[0] === D.id && r[5] === 6));

// 치유
const hp0 = B.last('welcome').you.hp;
await A.cast('bf_heal');
const heal = A.all('heal', (m) => m.id === B.id)[0];
check('치유: 낮은 체력 파티원 회복', !!heal && heal.n > 0, heal ? `+${heal.n}` : `hp0 ${hp0} cast ${JSON.stringify(A.all('cast').slice(-2))} err ${JSON.stringify(A.all('err').slice(-2))}`);
check('치유: 체력이 실제로 올라감', (B.last('me', (m) => m.s.hp !== undefined)?.s.hp ?? hp0) > hp0);
check('치유 연출 알림', !!A.last('cast', (m) => m.kind === 'heal' && m.ids.includes(B.id)));

// 버프
const atk0 = B.last('welcome').you.atk;
await A.cast('bf_bless');
const buffs = B.last('buffs');
check('축복: 공격력 증가 버프', !!buffs?.list.find((x) => x.id === 'atkUp'), JSON.stringify(buffs?.list.map((x) => x.id)));
const atk1 = B.last('me', (m) => m.s.atk !== undefined)?.s.atk;
check('축복: 능력치 반영(+18% 이상, 결속 포함)', atk1 > atk0 * 1.15, `${atk0} → ${atk1}`);
await A.cast('bf_aegis');
check('신의 가호: 방어력·수호', ['defUp', 'guard'].every((id) => B.last('buffs').list.some((x) => x.id === id)));
await A.cast('bf_shield');
const sh = B.last('buffs').list.find((x) => x.id === 'shield');
check('수호의 방패: 보호막', !!sh && (sh.val ?? 0) > 0, `${sh?.val}`);
check('파티 결속(가까이 있는 파티원)', B.last('buffs').list.some((x) => x.id === 'bond' && x.power >= 1), JSON.stringify(B.last('buffs').list.find((x) => x.id === 'bond')));

// 쿨타임
const cd0 = A.all('cdfail').length;
await A.cast('bf_bless', 300);
check('재사용 시간 중에는 실패', A.all('cdfail').length > cd0);

// 소생: D는 쓰러진 채로 접속했다
D.zin.length = 0;
A.zin.length = 0;
if (process.env.DEBUG) console.log('캐스트 직전 A.mp 등 확인');
A.send({ t: 'ping', c: 1 });
await wait(300);
if (process.env.DEBUG) console.log('핑 응답', A.zin.map((m) => m.t).join(','));
await A.cast('bf_raise', 1200);
if (process.env.DEBUG) {
  console.log('A 받은 종류', [...new Set(A.zin.map((m) => m.t))].join(','), '| cast:', JSON.stringify(A.all('cast')), '| err:', JSON.stringify(A.all('err')), '| cdfail:', A.all('cdfail').length);
  console.log('D 받은 종류', [...new Set(D.zin.map((m) => m.t))].join(','), '| pos:', JSON.stringify(D.all('pos')), '| me:', JSON.stringify(D.all('me').map((m) => m.s)));
}
const pos = D.last('pos');
check('소생의 빛: 쓰러진 파티원이 살아남', !!pos && (D.last('me', (m) => m.s.hp !== undefined)?.s.hp ?? 0) > 0, JSON.stringify(D.last('me', (m) => m.s.hp !== undefined)?.s));

// 슬라임을 찾아 디버프
const slimes = w.monsters.filter((m) => m.kind === 'slime');
const snapPos = (id) => {
  const s = [...C.zin].reverse().find((m) => m.t === 'snap' && m.m.some((r) => r[0] === id));
  const r = s?.m.find((r) => r[0] === id);
  return r ? [r[1], r[2]] : null;
};
slimes.sort((a, b) => Math.hypot(a.x - C.x, a.z - C.z) - Math.hypot(b.x - C.x, b.z - C.z));
const target = slimes[0];
const [tx, tz] = snapPos(target.id) ?? [target.x, target.z];
await walk([C], [[tx - 3, tz]]);
let [mx, mz] = snapPos(target.id) ?? [tx, tz];
C.move(C.x, C.z, Math.atan2(mx - C.x, mz - C.z));
await wait(300);
await C.cast('db_mark', 700);
const ms = C.all('mstatus', (m) => m.id === target.id);
check('약점의 낙인: 몬스터에 약점 노출', ms.some((m) => m.s.includes('vuln')), JSON.stringify(ms.map((m) => m.s)));
await C.cast('db_curse', 700);
check('쇠약의 저주: 방어력·공격력 약화', C.all('mstatus', (m) => m.id === target.id).some((m) => m.s.includes('defDown') && m.s.includes('atkDown')));
C.zin.length = 0;
await C.cast('db_chain', 800);
check('공포의 사슬: 속박', C.all('mstatus', (m) => m.id === target.id).some((m) => m.s.includes('bind')));
await wait(600);
const before = snapPos(target.id);
await wait(1500);
const after = snapPos(target.id);
check('속박된 몬스터는 제자리', !!before && !!after && Math.hypot(before[0] - after[0], before[1] - after[1]) < 0.3, JSON.stringify([before, after]));
await C.cast('db_miasma', 3200);
const dots = C.all('dmg', (m) => m.dot && m.id === target.id);
check('독무: 독 지속 피해', dots.length >= 1, `${dots.length}번`);
check('독 피해는 건 사람 이름으로', dots.every((m) => m.by === C.id));

// 파티원 살리기(스페이스): 멀리 쓰러져 있는 E에게 B가 다가가 살린다
await walk([B], [[-34, 11], [-31.5, 11.5]]);
const hpE0 = E.last('me', (m) => m.s.hp !== undefined)?.s.hp ?? 0;
E.zin.length = 0;
await wait(200);
B.send({ t: 'raise', id: E.id });
await wait(700);
check('스페이스로 쓰러진 파티원 살리기', !!E.last('pos') && (E.last('me', (m) => m.s.hp !== undefined)?.s.hp ?? 0) > hpE0, JSON.stringify(E.last('me', (m) => m.s.hp !== undefined)?.s));
check('살렸다는 알림', E.all('sys', (m) => m.text.includes('살려')).length > 0);
B.zin.length = 0;
B.send({ t: 'raise', id: E.id });
await wait(300);
check('살아난 사람에게 또 쓰면 효과 없음', B.all('sys', (m) => m.text.includes('살렸')).length === 0);
const far = await (async () => {
  // 다시 쓰러뜨릴 수 없으니 거리 검사는 D(이미 살아남)로 대신: 살아 있으면 무시되는지 확인
  C.zin.length = 0;
  C.send({ t: 'raise', id: D.id });
  await wait(300);
  return C.all('sys', (m) => m.text.includes('살렸')).length === 0;
})();
check('살아 있는 파티원에게는 효과 없음', far);

console.log(results.join('\n'));
for (const p of [A, B, C, D, E]) {
  p.zone.close();
  p.social.close();
}
void E;
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

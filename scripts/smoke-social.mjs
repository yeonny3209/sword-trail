// 소셜 연기 테스트: 전체 채팅·귓속말·파티 초대/수락/채팅/나가기·길드 창설/초대/채팅/탈퇴
// 사용법(로컬 서버 실행 중): node scripts/smoke-social.mjs
import { execSync } from 'node:child_process';

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

async function player(tag, cls, setup) {
  const { token } = await api('register', { name: `s${tag}${rnd}`, password: 'pass1234' });
  const name = `${tag}${rnd}`;
  const { id } = await api('characters', { name, cls }, token);
  if (setup) setup(id);
  const p = { name, id, zin: [], sin: [] };
  p.zone = await sock(`/ws?token=${token}&char=${id}`, p.zin);
  p.social = await sock(`/social?token=${token}&char=${id}`, p.sin);
  p.z = (m) => p.zone.send(JSON.stringify(m));
  p.s = (m) => p.social.send(JSON.stringify(m));
  p.got = (t, f = () => true) => p.sin.filter((m) => m.t === t && f(m));
  return p;
}

const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);

// A는 길드를 만들 수 있게 레벨 5·3000G로 시작
const a = await player('A', 'swordsman', (id) => {
  execSync(`npx wrangler d1 execute sword-trail-online --local --command "UPDATE characters SET level=5, data=json_set(data,'$.gold',3000) WHERE id=${id}"`, { stdio: 'ignore' });
});
const b = await player('B', 'blademaster');
const c = await player('C', 'berserker');
await wait(400);
for (const p of [a, b, c]) p.s({ t: 'where', zone: 'town', lv: 1 });

// 전체 채팅·귓속말
a.s({ t: 'chat', ch: 'world', text: '전체 안녕' });
await wait(300);
check('전체 채팅이 모두에게', [b, c].every((p) => p.got('chat', (m) => m.ch === 'world' && m.text === '전체 안녕').length));
b.s({ t: 'chat', ch: 'whisper', to: a.name, text: '귓속말' });
await wait(300);
check('귓속말 받는 사람', a.got('chat', (m) => m.ch === 'whisper' && m.from === b.name).length > 0);
check('귓속말은 다른 사람에게 안 감', c.got('chat', (m) => m.ch === 'whisper').length === 0);
check('보낸 사람 메아리', b.got('chat', (m) => m.ch === 'whisper' && m.from.startsWith('→')).length > 0);
check('접속자 수', [...a.sin].reverse().find((m) => m.t === 'online')?.n >= 3);

// 파티
a.s({ t: 'pinvite', name: b.name });
await wait(300);
const inv = b.got('pinvite')[0];
check('파티 초대 도착', !!inv);
b.s({ t: 'preply', from: inv?.from, ok: true });
await wait(400);
const pa = [...a.sin].reverse().find((m) => m.t === 'party');
check('파티 구성', pa?.members.length === 2 && pa.leader === a.id, JSON.stringify(pa?.members.map((m) => m.name)));
b.s({ t: 'pinvite', name: c.name });
await wait(300);
check('파티원은 초대 못 함', b.got('err').some((m) => m.text.includes('파티장')));
a.s({ t: 'chat', ch: 'party', text: '파티 채팅' });
await wait(300);
check('파티 채팅', b.got('chat', (m) => m.ch === 'party').length > 0 && c.got('chat', (m) => m.ch === 'party').length === 0);
b.s({ t: 'pleave' });
await wait(400);
check('나가면 해산', a.got('noparty').length > 0 && b.got('noparty').length > 0);

// 길드: 레벨 1인 B는 못 만들고, A는 길드 관리인 앞에서 창설
b.z({ t: 'gcreate', name: `길${rnd.slice(0, 3)}` });
await wait(300);
check('NPC에서 멀면 창설 불가', b.zin.some((m) => m.t === 'err' && m.text.includes('관리인')));
for (let x = 0; x <= 20; x += 0.8) { a.z({ t: 'move', x, z: 4, y: 0, f: 1.57, st: 1 }); await wait(110); }
for (let z = 4; z <= 8; z += 0.8) { a.z({ t: 'move', x: 20, z, y: 0, f: 0, st: 1 }); await wait(110); }
await wait(200);
const gname = `G${rnd.slice(0, 5)}`;
a.z({ t: 'gcreate', name: gname });
await wait(800);
const ga = [...a.sin].reverse().find((m) => m.t === 'guild');
check('길드 창설', ga?.g.name === gname, a.zin.filter((m) => m.t === 'err').map((m) => m.text).join(','));
check('창설 비용 차감', a.zin.some((m) => m.t === 'me' && m.s.gold === 1000));
check('같은 존에 이름표 갱신', b.zin.some((m) => m.t === 'pinfo' && m.p.guild === gname));
a.s({ t: 'ginvite', name: b.name });
await wait(300);
const gi = b.got('ginvite')[0];
b.s({ t: 'greply', gid: gi?.gid, ok: true });
await wait(600);
const gb = [...b.sin].reverse().find((m) => m.t === 'guild');
check('길드 가입', gb?.g.members.length === 2);
b.s({ t: 'chat', ch: 'guild', text: '길드 채팅' });
await wait(300);
check('길드 채팅', a.got('chat', (m) => m.ch === 'guild').length > 0 && c.got('chat', (m) => m.ch === 'guild').length === 0);
b.s({ t: 'gleave' });
await wait(400);
check('길드 탈퇴', b.got('noguild').length > 0);
a.s({ t: 'gleave' });
await wait(400);
check('혼자 남은 길드장 탈퇴 = 해산', a.got('sys', (m) => m.text.includes('해산')).length > 0);

console.log(results.join('\n'));
for (const p of [a, b, c]) {
  p.zone.close();
  p.social.close();
}
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

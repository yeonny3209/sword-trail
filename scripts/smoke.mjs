// 로컬 서버 연기 테스트: 가입 → 캐릭터 생성 → 접속 → 이동·채팅 → 두 명이 서로 보이는지
// 사용법: node scripts/smoke.mjs [http://127.0.0.1:8787]
const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const rnd = Math.random().toString(36).slice(2, 7);

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

async function makePlayer(tag, cls) {
  const name = `t${tag}${rnd}`;
  const { token } = await api('register', { name, password: 'pass1234' });
  const { id } = await api('characters', { name: `c${tag}${rnd}`, cls }, token);
  const chars = await api('characters', null, token);
  const ws = new WebSocket(`${WS}/ws?token=${token}&char=${id}`);
  const inbox = [];
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
  await new Promise((ok, bad) => { ws.addEventListener('open', ok); ws.addEventListener('error', bad); });
  return { name, token, id, ws, inbox, chars, send: (m) => ws.send(JSON.stringify(m)) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const a = await makePlayer('a', 'swordsman');
await wait(300);
const b = await makePlayer('b', 'spellblade');
await wait(300);
a.send({ t: 'move', x: 3, z: 4, y: 0, f: 1, st: 1 });
b.send({ t: 'chat', ch: 'zone', text: '안녕하세요' });
await wait(600);

const welcomeB = b.inbox.find((m) => m.t === 'welcome');
const joinA = a.inbox.find((m) => m.t === 'join');
const chatA = a.inbox.find((m) => m.t === 'chat');
const snapB = [...b.inbox].reverse().find((m) => m.t === 'snap');
const aInSnap = snapB?.p.find((r) => r[0] === a.id);
console.log(JSON.stringify({
  chars: a.chars,
  bSeesA: welcomeB?.players.map((p) => p.name),
  aSawJoin: joinA?.p.name,
  aGotChat: chatA && `${chatA.from}: ${chatA.text}`,
  aPosInBSnap: aInSnap?.slice(1, 3),
}, null, 1));

// 포탈 이동: 동쪽 포탈 앞으로 걸어가서 사용
for (let x = 3; x <= 33; x += 1) { a.send({ t: 'move', x, z: 0, y: 0, f: 1.57, st: 1 }); await wait(110); }
a.send({ t: 'portal', id: 'east' });
await wait(800);
console.log('portal:', JSON.stringify(a.inbox.filter((m) => m.t === 'goto' || m.t === 'err' || m.t === 'pos')));
const a2 = new WebSocket(`${WS}/ws?token=${a.token}&char=${a.id}`);
const w2 = await new Promise((ok) => a2.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.t === 'welcome') ok(m); }));
console.log('after portal:', w2.zone, w2.you.x, w2.you.z);
a2.close(); a.ws.close(); b.ws.close();
await wait(300);
process.exit(0);

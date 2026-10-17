// 경매장·우편함·거래 연기 테스트(로컬 서버 실행 중): node scripts/smoke-market.mjs
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

async function player(tag, gold) {
  const { token } = await api('register', { name: `m${tag}${rnd}`, password: 'pass1234' });
  const name = `${tag}${rnd}`;
  const { id } = await api('characters', { name, cls: 'swordsman' }, token);
  if (gold) execSync(`npx wrangler d1 execute sword-trail-online --local --command "UPDATE characters SET data=json_set(data,'$.gold',${gold}) WHERE id=${id}"`, { stdio: 'ignore' });
  const p = { name, id, zin: [], sin: [], x: 0, z: 4 };
  p.zone = await sock(`/ws?token=${token}&char=${id}`, p.zin);
  p.social = await sock(`/social?token=${token}&char=${id}`, p.sin);
  p.send = (m) => p.zone.send(JSON.stringify(m));
  p.last = (t) => [...p.zin].reverse().find((m) => m.t === t);
  p.inv = () => p.last('inv');
  p.uidOf = (id) => p.inv().inv.find((s) => s.id === id)?.uid;
  p.count = (id) => p.inv().inv.filter((s) => s.id === id).reduce((a, s) => a + s.n, 0);
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
const b = await player('B', 5000);
await wait(500);
const goldA0 = a.inv().gold;

// 경매장: 멀리서는 안 됨
a.send({ t: 'ahsearch', q: '', cat: 'all', page: 0 });
await wait(300);
check('경매인에서 멀면 거절', a.zin.some((m) => m.t === 'err' && m.text.includes('경매인')));

await walk([a, b], [[-20, 4], [-20, 8]]);
a.send({ t: 'ahsell', uid: a.uidOf('pot_hp_s'), n: 2, price: 100 });
await wait(800);
check('등록 후 가방에서 빠짐', a.count('pot_hp_s') === 3, `${a.count('pot_hp_s')}`);
const mine = a.last('ah');
check('내 물품 목록', mine?.mine && mine.rows.length === 1 && mine.rows[0].item.n === 2);
b.send({ t: 'ahsearch', q: '', cat: 'potion', page: 0 });
await wait(600);
const found = b.last('ah')?.rows.find((r) => r.seller === a.name);
check('검색에 보임', !!found);
const potB0 = b.count('pot_hp_s');
b.send({ t: 'ahbuy', id: found?.id });
await wait(800);
check('구매: 골드 차감', b.inv().gold === 4900, `${b.inv().gold}`);
check('구매: 아이템 받음', b.count('pot_hp_s') === potB0 + 2);
check('판매자 알림', a.sin.some((m) => m.t === 'sys' && m.text.includes('팔렸')));
// 연속 요청은 거절하지 않고 차례로 처리
b.send({ t: 'ahsearch', q: '', cat: 'all', page: 0 });
b.send({ t: 'ahmine' });
await wait(800);
check('연속 요청 처리', !b.zin.some((m) => m.t === 'err' && m.text.includes('처리 중')) && b.zin.filter((m) => m.t === 'ah' && m.mine).length > 0);
b.send({ t: 'ahbuy', id: found?.id });
await wait(500);
check('두 번 살 수 없음', b.zin.some((m) => m.t === 'err' && m.text.includes('팔렸')));

// 등록 후 취소
a.send({ t: 'ahsell', uid: a.uidOf('pot_mp_s'), n: 1, price: 999 });
await wait(800);
const row = a.last('ah')?.rows.find((r) => r.item.id === 'pot_mp_s');
a.send({ t: 'ahcancel', id: row?.id });
await wait(800);
check('등록 취소하면 돌아옴', a.count('pot_mp_s') === 3);

// 우편: 판매 대금 받기, 보내기
await walk([a, b], [[5, 4], [5, -1]]);
a.send({ t: 'mlist' });
await wait(600);
const sale = a.last('mail')?.rows.find((r) => r.subject.startsWith('판매 완료'));
check('판매 대금 우편(수수료 5%)', sale?.gold === 95, JSON.stringify(sale?.subject));
a.send({ t: 'mtake', id: sale?.id });
await wait(800);
check('대금 받기', a.inv().gold === goldA0 + 95, `${a.inv().gold}`);
a.send({ t: 'msend', to: b.name, subject: '선물', body: '잘 써', gold: 50, uid: a.uidOf('pot_mp_s'), n: 1 });
await wait(800);
check('보내기: 골드 50 + 수수료 10', a.inv().gold === goldA0 + 95 - 60, `${a.inv().gold}`);
check('받는 사람 알림', b.sin.some((m) => m.t === 'sys' && m.text.includes('우편')));
b.send({ t: 'mlist' });
await wait(600);
const gift = b.last('mail')?.rows.find((r) => r.subject === '선물');
check('받은 우편', gift?.gold === 50 && gift.item?.id === 'pot_mp_s');
b.send({ t: 'mtake', id: gift?.id });
await wait(800);
check('첨부 받기', b.inv().gold === 4950 && b.count('pot_mp_s') === 4);
b.send({ t: 'mdel', id: gift?.id });
await wait(600);
check('빈 우편 지우기', !b.last('mail')?.rows.some((r) => r.id === gift?.id));

// 거래
const ga = a.inv().gold, gb = b.inv().gold;
a.send({ t: 'treq', id: b.id });
await wait(300);
check('거래 신청 도착', !!b.last('treq'));
b.send({ t: 'tans', id: a.id, ok: true });
await wait(300);
check('거래 창 열림', !!a.last('trade') && !!b.last('trade'));
a.send({ t: 'tset', items: [{ uid: a.uidOf('pot_hp_s'), n: 1 }], gold: 10 });
b.send({ t: 'tset', items: [], gold: 200 });
await wait(300);
check('상대가 내놓은 것 보임', b.last('trade')?.theirs.items[0]?.id === 'pot_hp_s' && b.last('trade').theirs.gold === 10);
a.send({ t: 'tready', ok: true });
await wait(200);
b.send({ t: 'tset', items: [], gold: 150 });
await wait(300);
check('바꾸면 준비가 풀림', a.last('trade')?.mine.ready === false);
a.send({ t: 'tready', ok: true });
b.send({ t: 'tready', ok: true });
await wait(800);
check('거래 완료', a.last('tend')?.ok === true && b.last('tend')?.ok === true);
check('거래 결과 골드', a.inv().gold === ga - 10 + 150 && b.inv().gold === gb - 150 + 10, `${a.inv().gold} ${b.inv().gold}`);
check('거래 결과 아이템', b.count('pot_hp_s') === potB0 + 3);

console.log(results.join('\n'));
for (const p of [a, b]) {
  p.zone.close();
  p.social.close();
}
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

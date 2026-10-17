// Cloudflare 첫 배포 도우미: 로그인 확인 → D1 데이터베이스 만들기(없으면) → 테이블 만들기 → 빌드·배포
// 먼저 `npx wrangler login` 으로 로그인한 뒤: npm run cloud:setup
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DB = 'sword-trail-online';
const CONFIG = 'wrangler.jsonc';
const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

function run(cmd, { capture = false } = {}) {
  console.log(`\n> ${cmd}`);
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', env: { ...process.env, CI: '1' } });
  if (capture) process.stdout.write(r.stdout ?? '');
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

// 1. 로그인
const who = run('npx wrangler whoami', { capture: true });
if (!who.ok || /not authenticated|You are not logged in/i.test(who.out)) fail('Cloudflare에 로그인되어 있지 않습니다. 먼저 `npx wrangler login` 을 실행하세요.');

// 2. D1 데이터베이스 id
let config = readFileSync(CONFIG, 'utf8');
if (config.includes(PLACEHOLDER)) {
  let id = null;
  const created = run(`npx wrangler d1 create ${DB}`, { capture: true });
  id = created.out.match(/"database_id":\s*"([0-9a-f-]{36})"/)?.[1] ?? created.out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/)?.[1] ?? null;
  if (!id) {
    // 이미 있으면 목록에서 찾는다
    const list = run('npx wrangler d1 list --json', { capture: true });
    try {
      const rows = JSON.parse(list.out.slice(list.out.indexOf('[')));
      id = rows.find((r) => r.name === DB)?.uuid ?? null;
    } catch {
      /* 아래에서 실패 처리 */
    }
  }
  if (!id) fail('D1 데이터베이스를 만들거나 찾지 못했습니다. 위 출력을 확인하세요.');
  config = config.replace(PLACEHOLDER, id);
  writeFileSync(CONFIG, config);
  console.log(`\n✔ ${CONFIG} 에 database_id ${id} 를 적었습니다.`);
} else console.log('\n✔ database_id 가 이미 설정되어 있습니다.');

// 3. 테이블(마이그레이션)
if (!run(`npx wrangler d1 migrations apply ${DB} --remote`).ok) fail('원격 D1 마이그레이션에 실패했습니다.');

// 4. 빌드·배포
if (!run('npm run build').ok) fail('빌드에 실패했습니다.');
const dep = run('npx wrangler deploy', { capture: true });
if (!dep.ok) fail('배포에 실패했습니다. 위 출력을 확인하세요(workers.dev 하위 도메인이 없다면 Cloudflare 대시보드 Workers 화면에서 한 번 만들어 주세요).');
const url = dep.out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
console.log(`\n✔ 배포 완료${url ? `: ${url}` : ''}`);
console.log('  다음부터 코드가 바뀌면 `npm run deploy`, 테이블이 바뀌면 `npm run db:migrate:remote` 만 실행하면 됩니다.');

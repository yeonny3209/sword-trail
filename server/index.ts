import { baseZone, isClassId, ZONES, START_ZONE } from '../shared/data';
import { NAME_RE } from '../shared/protocol';
import { accountFromToken, login, register, validateCredentials } from './auth';
import { createCharacter, deleteCharacter, listCharacters, loadCharacter } from './db';
import type { Env } from './env';
import { bearer, fail, json, readJson } from './http';

export { ZoneDO } from './zone/ZoneDO';
export { SocialDO } from './social/SocialDO';

/** Worker 진입점: /api/* 는 REST, /ws 는 존 DO로 연결, 나머지는 정적 파일 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, env, url);
      if (url.pathname === '/ws') return await connect(req, env, url);
      if (url.pathname === '/social') return await connectSocial(req, env, url);
    } catch (e) {
      console.error(e);
      return fail('서버 오류가 발생했습니다.', 500);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.slice(5);
  if (req.method === 'POST' && (path === 'register' || path === 'login')) {
    const body = await readJson<{ name: string; password: string }>(req);
    const bad = validateCredentials(body.name, body.password);
    if (bad) return fail(bad);
    const r = path === 'register' ? await register(env, body.name!, body.password!) : await login(env, body.name!, body.password!);
    return 'error' in r ? fail(r.error, path === 'login' ? 401 : 409) : json({ token: r.token, account: body.name });
  }
  const account = await accountFromToken(env, bearer(req));
  if (!account) return fail('다시 로그인해 주세요.', 401);

  if (path === 'characters' && req.method === 'GET') return json(await listCharacters(env, account));
  if (path === 'characters' && req.method === 'POST') {
    const body = await readJson<{ name: string; cls: string }>(req);
    if (typeof body.name !== 'string' || !NAME_RE.test(body.name)) return fail('캐릭터 이름은 한글·영문·숫자 2~12자입니다.');
    if (!isClassId(body.cls)) return fail('직업을 골라 주세요.');
    const r = await createCharacter(env, account, body.name, body.cls);
    return 'error' in r ? fail(r.error, 409) : json(r);
  }
  const del = path.match(/^characters\/(\d+)$/);
  if (del && req.method === 'DELETE') {
    return (await deleteCharacter(env, account, Number(del[1]))) ? json({ ok: true }) : fail('캐릭터를 찾을 수 없습니다.', 404);
  }
  return fail('없는 주소입니다.', 404);
}

/** 소셜 웹소켓: 하나뿐인 소셜 DO로 넘긴다 */
async function connectSocial(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.headers.get('Upgrade') !== 'websocket') return fail('웹소켓이 필요합니다.', 426);
  const account = await accountFromToken(env, url.searchParams.get('token'));
  if (!account) return fail('다시 로그인해 주세요.', 401);
  const row = await loadCharacter(env, Number(url.searchParams.get('char')));
  if (!row || row.account_id !== account) return fail('캐릭터를 찾을 수 없습니다.', 404);
  const headers = new Headers(req.headers);
  headers.set('X-Char-Id', String(row.id));
  return env.SOCIAL.get(env.SOCIAL.idFromName('global')).fetch(new Request(req, { headers }));
}

/** 웹소켓: 토큰과 캐릭터를 확인하고, 캐릭터가 있는 존의 DO로 넘긴다 */
async function connect(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.headers.get('Upgrade') !== 'websocket') return fail('웹소켓이 필요합니다.', 426);
  const account = await accountFromToken(env, url.searchParams.get('token'));
  if (!account) return fail('다시 로그인해 주세요.', 401);
  const charId = Number(url.searchParams.get('char'));
  const row = Number.isInteger(charId) ? await loadCharacter(env, charId) : null;
  if (!row || row.account_id !== account) return fail('캐릭터를 찾을 수 없습니다.', 404);
  const zone = ZONES[baseZone(row.zone)] ? row.zone : START_ZONE;
  const headers = new Headers(req.headers);
  headers.set('X-Char-Id', String(row.id));
  headers.set('X-Zone', zone);
  const stub = env.ZONE.get(env.ZONE.idFromName(zone));
  return stub.fetch(new Request(req, { headers }));
}

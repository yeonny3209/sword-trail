import { NAME_RE } from '../shared/protocol';
import type { Env } from './env';

const ITERATIONS = 100_000;
const SESSION_DAYS = 30;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** PBKDF2-SHA256으로 비밀번호를 해시한다(원문은 저장하지 않음) */
async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return toHex(bits);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function createSession(env: Env, accountId: number): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await env.DB.prepare('INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)').bind(token, accountId, expires).run();
  return token;
}

export function validateCredentials(name: unknown, password: unknown): string | null {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return '아이디는 한글·영문·숫자 2~12자입니다.';
  if (typeof password !== 'string' || password.length < 4 || password.length > 64) return '비밀번호는 4~64자입니다.';
  return null;
}

export async function register(env: Env, name: string, password: string): Promise<{ token: string } | { error: string }> {
  const exists = await env.DB.prepare('SELECT id FROM accounts WHERE name = ?').bind(name).first();
  if (exists) return { error: '이미 있는 아이디입니다.' };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  const res = await env.DB.prepare('INSERT INTO accounts (name, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)')
    .bind(name, hash, toHex(salt), Date.now()).run();
  return { token: await createSession(env, Number(res.meta.last_row_id)) };
}

export async function login(env: Env, name: string, password: string): Promise<{ token: string } | { error: string }> {
  const row = await env.DB.prepare('SELECT id, pass_hash, salt FROM accounts WHERE name = ?')
    .bind(name).first<{ id: number; pass_hash: string; salt: string }>();
  if (!row) return { error: '아이디 또는 비밀번호가 틀렸습니다.' };
  const hash = await hashPassword(password, fromHex(row.salt));
  if (!timingSafeEqual(hash, row.pass_hash)) return { error: '아이디 또는 비밀번호가 틀렸습니다.' };
  return { token: await createSession(env, row.id) };
}

/** 토큰 → 계정 id(만료·없음이면 null) */
export async function accountFromToken(env: Env, token: string | null): Promise<number | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare('SELECT account_id, expires_at FROM sessions WHERE token = ?')
    .bind(token).first<{ account_id: number; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return row.account_id;
}

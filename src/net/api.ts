import type { AuthResponse, CharacterSummary } from '../../shared/protocol';
import type { ClassId } from '../../shared/types';

const TOKEN_KEY = 'sto-token';
const ACCOUNT_KEY = 'sto-account';

export function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function savedAccount(): string {
  try {
    return localStorage.getItem(ACCOUNT_KEY) ?? '';
  } catch {
    return '';
  }
}

function store(token: string | null, account?: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (account) localStorage.setItem(ACCOUNT_KEY, account);
  } catch {
    /* 저장 불가 환경 */
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = savedToken();
  const res = await fetch(`/api/${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? '연결에 실패했습니다.', res.status);
  return data as T;
}

export async function auth(kind: 'login' | 'register', name: string, password: string): Promise<void> {
  const r = await call<AuthResponse>(kind, { method: 'POST', body: JSON.stringify({ name, password }) });
  store(r.token, r.account);
}

export function logout(): void {
  store(null);
}

export const listCharacters = () => call<CharacterSummary[]>('characters');
export const createCharacter = (name: string, cls: ClassId) =>
  call<{ id: number }>('characters', { method: 'POST', body: JSON.stringify({ name, cls }) });
export const deleteCharacter = (id: number) => call<{ ok: boolean }>(`characters/${id}`, { method: 'DELETE' });

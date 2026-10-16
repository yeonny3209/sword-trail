/** 브라우저 localStorage 저장. 버전 번호로 이전 구조를 변환한다. */

export interface Settings {
  volume: number;
  mouseSensitivity: number;
  screenShake: boolean;
}

export interface DeathRecord {
  room: string;
  cause: string;
  seconds: number;
}

export interface SaveData {
  version: number;
  shards: number;
  upgrades: Record<string, number>;
  swords: string[];
  equipped: string;
  stats: { runs: number; wins: number; bestSeconds: number; deaths: DeathRecord[] };
  settings: Settings;
}

export const SAVE_VERSION = 1;

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    shards: 0,
    upgrades: {},
    swords: ['trainee'],
    equipped: 'trainee',
    stats: { runs: 0, wins: 0, bestSeconds: 0, deaths: [] },
    settings: { volume: 1, mouseSensitivity: 1, screenShake: true },
  };
}

/** 저장 구조 변환. 버전이 없거나 낮으면 빠진 값을 기본값으로 채운다. */
export function migrate(raw: unknown): SaveData {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SaveData> & { shard?: number };
  // 버전 0(가상): shards 대신 shard 필드를 쓰던 구조
  const shards = typeof r.shards === 'number' ? r.shards : typeof r.shard === 'number' ? r.shard : 0;
  const swords = Array.isArray(r.swords) && r.swords.length ? r.swords : base.swords;
  return {
    version: SAVE_VERSION,
    shards: Math.max(0, Math.floor(shards)),
    upgrades: { ...(r.upgrades ?? {}) },
    swords,
    equipped: r.equipped && swords.includes(r.equipped) ? r.equipped : swords[0],
    stats: { ...base.stats, ...(r.stats ?? {}), deaths: [...(r.stats?.deaths ?? [])].slice(-20) },
    settings: { ...base.settings, ...(r.settings ?? {}) },
  };
}

export function loadSave(key: string): SaveData {
  try {
    const text = localStorage.getItem(key);
    return migrate(text ? JSON.parse(text) : null);
  } catch {
    return defaultSave();
  }
}

export function writeSave(key: string, data: SaveData): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* 저장 불가(사생활 보호 모드 등) — 진행은 메모리에만 */
  }
}

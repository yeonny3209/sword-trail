-- 계정·세션·캐릭터
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_account ON sessions(account_id);

CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  class TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  zone TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  z REAL NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_characters_account ON characters(account_id);

-- 길드
CREATE TABLE guilds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  leader_id INTEGER NOT NULL,
  notice TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE guild_members (
  char_id INTEGER PRIMARY KEY,
  guild_id INTEGER NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL
);
CREATE INDEX idx_guild_members_guild ON guild_members(guild_id);

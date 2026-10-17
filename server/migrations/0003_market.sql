-- 경매장(즉시 구매)과 우편함
CREATE TABLE auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL,
  seller_name TEXT NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cat TEXT NOT NULL,
  lv INTEGER NOT NULL,
  n INTEGER NOT NULL,
  item TEXT NOT NULL,
  price INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auctions_cat ON auctions(cat, price);
CREATE INDEX auctions_seller ON auctions(seller_id);
CREATE INDEX auctions_exp ON auctions(expires_at);

CREATE TABLE mail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_id INTEGER NOT NULL,
  from_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  gold INTEGER NOT NULL DEFAULT 0,
  item TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX mail_to ON mail(to_id, id);

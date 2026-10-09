-- Accounts (username + password) and cloud saves (owner direction, 2026-10-06; built 2026-10-08).
-- The in-game save is the only commit point: a save = the game's SRAM + the party's minds, every version kept.
ALTER TABLE players ADD COLUMN username TEXT;
ALTER TABLE players ADD COLUMN password_hash TEXT;   -- PBKDF2-SHA256, 100k rounds, hex
ALTER TABLE players ADD COLUMN password_salt TEXT;   -- hex
ALTER TABLE players ADD COLUMN active_session TEXT;  -- token_hash of the one device allowed to play and save
CREATE UNIQUE INDEX players_username ON players(username);

CREATE TABLE saves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT NOT NULL REFERENCES players(id),
  version     INTEGER NOT NULL,           -- 1, 2, 3… per player
  at          INTEGER NOT NULL,           -- server time
  rom         TEXT,                       -- ROM sha1 prefix the save was made on
  sram        TEXT NOT NULL,              -- base64 of the 128 KB battery save
  minds       TEXT NOT NULL,              -- JSON: readers, hot memory, Pokédex, code history per Pokémon
  sha256      TEXT NOT NULL,              -- of sram, to skip identical uploads
  note        TEXT
);
CREATE UNIQUE INDEX saves_player_version ON saves(player_id, version);

-- login attempts, for rate limiting (rolling window)
CREATE TABLE logins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL,
  at          INTEGER NOT NULL,
  ok          INTEGER NOT NULL
);
CREATE INDEX logins_user_at ON logins(username, at);

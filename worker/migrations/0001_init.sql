-- Code Red backend: invites, players, sessions, progress events, recorded LLM calls.
-- Times are unix milliseconds.

CREATE TABLE invites (
  code        TEXT PRIMARY KEY,
  note        TEXT,
  max_uses    INTEGER NOT NULL DEFAULT 1,
  uses        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE players (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  invite      TEXT NOT NULL REFERENCES invites(code),
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

-- token_hash = sha256(bearer token), hex. The token itself is never stored.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id),
  created_at  INTEGER NOT NULL,
  user_agent  TEXT
);
CREATE INDEX sessions_player ON sessions(player_id);

-- kind: short slug ('session_start', 'badge', 'flag', 'map', 'challenge', ...); data: JSON.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT NOT NULL REFERENCES players(id),
  at          INTEGER NOT NULL,   -- client time
  received_at INTEGER NOT NULL,   -- server time
  kind        TEXT NOT NULL,
  data        TEXT
);
CREATE INDEX events_player_at ON events(player_id, at);
CREATE INDEX events_kind ON events(kind);

-- Every agent call, full request/response, so runs can be replayed (sim, debugging).
CREATE TABLE llm_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     TEXT NOT NULL REFERENCES players(id),
  at            INTEGER NOT NULL,
  model         TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  request       TEXT NOT NULL,
  response      TEXT,
  status        INTEGER NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  ms            INTEGER NOT NULL
);
CREATE INDEX llm_calls_player_at ON llm_calls(player_id, at);
CREATE INDEX llm_calls_hash ON llm_calls(request_hash);

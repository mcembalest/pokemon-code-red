-- Account recovery without email (2026-10-09): a one-time recovery code, shown once at join (and again
-- after every use), stored only as a PBKDF2 hash like the password. Failed attempts are rate limited
-- through `logins` (kind 'recover').
ALTER TABLE players ADD COLUMN recovery_hash TEXT;
ALTER TABLE players ADD COLUMN recovery_salt TEXT;
ALTER TABLE players ADD COLUMN password_changed_at INTEGER;
ALTER TABLE logins ADD COLUMN kind TEXT NOT NULL DEFAULT 'login';

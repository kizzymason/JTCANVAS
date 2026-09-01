export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  password        TEXT NOT NULL,
  totp_secret     TEXT NOT NULL,
  recovery_email  TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending',
  api_key         TEXT,
  cookie_token    TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  screenshot_path TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS registration_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER,
  level       TEXT NOT NULL DEFAULT 'info',
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_logs_account ON registration_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON registration_logs(created_at);
`;

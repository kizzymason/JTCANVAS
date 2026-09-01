import { all, get, run, transaction, lastInsertId } from './index';
import type { Account, AccountStatus, SafeAccount } from '../types';

interface AccountRow {
  id: number;
  username: string;
  password: string;
  totp_secret: string;
  recovery_email: string;
  status: string;
  api_key: string | null;
  cookie_token: string | null;
  attempts: number;
  last_error: string | null;
  screenshot_path: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: AccountRow): Account {
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    totpSecret: row.totp_secret,
    recoveryEmail: row.recovery_email,
    status: row.status as AccountStatus,
    apiKey: row.api_key,
    cookieToken: row.cookie_token,
    attempts: row.attempts,
    lastError: row.last_error,
    screenshotPath: row.screenshot_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function stripPassword(account: Account): SafeAccount {
  const { password, ...safe } = account;
  void password;
  return safe;
}

export function listAccounts(status?: AccountStatus): Account[] {
  const rows = status
    ? all<AccountRow>('SELECT * FROM accounts WHERE status = ? ORDER BY id ASC', [status])
    : all<AccountRow>('SELECT * FROM accounts ORDER BY id ASC');
  return rows.map(mapRow);
}

export function getAccount(id: number): Account | null {
  const row = get<AccountRow>('SELECT * FROM accounts WHERE id = ?', [id]);
  return row ? mapRow(row) : null;
}

export function findByUsername(username: string): Account | null {
  const row = get<AccountRow>('SELECT * FROM accounts WHERE username = ?', [username]);
  return row ? mapRow(row) : null;
}

export interface NewAccount {
  username: string;
  password: string;
  totpSecret: string;
  recoveryEmail: string;
}

export function createAccount(input: NewAccount): Account {
  run(
    `INSERT INTO accounts (username, password, totp_secret, recovery_email, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [input.username, input.password, input.totpSecret, input.recoveryEmail],
  );
  const account = getAccount(lastInsertId());
  if (!account) throw new Error('Failed to read back the inserted account');
  return account;
}

export interface BulkImportResult {
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Re-importing a username refreshes its credentials instead of failing on the
 * UNIQUE constraint, which is what people expect when they paste a corrected list.
 */
export function bulkUpsert(accounts: NewAccount[]): BulkImportResult {
  const result: BulkImportResult = { inserted: 0, updated: 0, skipped: 0 };
  transaction(() => {
    for (const acc of accounts) {
      const existing = findByUsername(acc.username);
      if (!existing) {
        run(
          `INSERT INTO accounts (username, password, totp_secret, recovery_email, status)
           VALUES (?, ?, ?, ?, 'pending')`,
          [acc.username, acc.password, acc.totpSecret, acc.recoveryEmail],
        );
        result.inserted += 1;
      } else if (
        existing.password !== acc.password ||
        existing.totpSecret !== acc.totpSecret ||
        existing.recoveryEmail !== acc.recoveryEmail
      ) {
        run(
          `UPDATE accounts SET password = ?, totp_secret = ?, recovery_email = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [acc.password, acc.totpSecret, acc.recoveryEmail, existing.id],
        );
        result.updated += 1;
      } else {
        result.skipped += 1;
      }
    }
  });
  return result;
}

const UPDATABLE_COLUMNS: Record<string, string> = {
  username: 'username',
  password: 'password',
  totpSecret: 'totp_secret',
  recoveryEmail: 'recovery_email',
  status: 'status',
  apiKey: 'api_key',
  cookieToken: 'cookie_token',
  attempts: 'attempts',
  lastError: 'last_error',
  screenshotPath: 'screenshot_path',
};

export type AccountUpdate = Partial<
  Pick<
    Account,
    | 'username'
    | 'password'
    | 'totpSecret'
    | 'recoveryEmail'
    | 'status'
    | 'apiKey'
    | 'cookieToken'
    | 'attempts'
    | 'lastError'
    | 'screenshotPath'
  >
>;

/**
 * Only keys present in UPDATABLE_COLUMNS reach the SQL string; every value is bound.
 */
export function updateAccount(id: number, updates: AccountUpdate): Account | null {
  const entries = Object.entries(updates).filter(([key]) => key in UPDATABLE_COLUMNS);
  if (entries.length === 0) return getAccount(id);

  const setClause = entries.map(([key]) => `${UPDATABLE_COLUMNS[key]} = ?`).join(', ');
  const values = entries.map(([, value]) => (value === undefined ? null : (value as string | number | null)));

  run(`UPDATE accounts SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [...values, id]);
  return getAccount(id);
}

export function deleteAccount(id: number): void {
  run('DELETE FROM accounts WHERE id = ?', [id]);
}

export function deleteAccounts(ids: number[]): number {
  if (ids.length === 0) return 0;
  transaction(() => {
    for (const id of ids) {
      run('DELETE FROM accounts WHERE id = ?', [id]);
    }
  });
  return ids.length;
}

export function deleteByStatus(status: AccountStatus): number {
  const victims = listAccounts(status);
  return deleteAccounts(victims.map((a) => a.id));
}

export function resetStatuses(from: AccountStatus, to: AccountStatus): number {
  const victims = listAccounts(from);
  transaction(() => {
    for (const acc of victims) {
      run(
        `UPDATE accounts SET status = ?, last_error = NULL, updated_at = datetime('now') WHERE id = ?`,
        [to, acc.id],
      );
    }
  });
  return victims.length;
}

export function countByStatus(): Record<AccountStatus, number> {
  const rows = all<{ status: string; n: number }>(
    'SELECT status, COUNT(*) AS n FROM accounts GROUP BY status',
  );
  const counts: Record<AccountStatus, number> = { pending: 0, running: 0, completed: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in counts) counts[row.status as AccountStatus] = Number(row.n);
  }
  return counts;
}

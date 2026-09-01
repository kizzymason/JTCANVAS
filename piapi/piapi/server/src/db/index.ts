import fs from 'fs';
import path from 'path';
import initSqlJs, { Database, SqlValue, BindParams } from 'sql.js';
import { paths } from '../config';
import { SCHEMA_SQL } from './schema';

let db: Database | null = null;
let persistTimer: NodeJS.Timeout | null = null;
let persistPending = false;

function requireDb(): Database {
  if (!db) {
    throw new Error('Database accessed before initDatabase() completed');
  }
  return db;
}

/**
 * sql.js keeps everything in memory, so the file only changes when we export it.
 * Writes are coalesced because a full dump on every INSERT makes bulk import O(n^2).
 */
function schedulePersist(): void {
  persistPending = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushToDisk();
  }, 250);
}

export function flushToDisk(): void {
  if (!db || !persistPending) return;
  persistPending = false;
  const data = db.export();
  fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true });
  const tmp = `${paths.dbFile}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, paths.dbFile);
}

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });

  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.screenshots, { recursive: true });

  if (fs.existsSync(paths.dbFile)) {
    db = new SQL.Database(fs.readFileSync(paths.dbFile));
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON;');
  db.run(SCHEMA_SQL);

  // CREATE TABLE IF NOT EXISTS does not add columns to databases from older
  // images. Keep this migration idempotent so existing account data survives
  // upgrades without a separate migration runner.
  const accountColumns = db.exec('PRAGMA table_info(accounts)');
  const names = new Set(
    accountColumns[0]?.values.map((row) => String(row[1])) ?? [],
  );
  if (!names.has('recovery_email')) {
    db.run("ALTER TABLE accounts ADD COLUMN recovery_email TEXT NOT NULL DEFAULT ''");
  }

  persistPending = true;
  flushToDisk();
}

export function closeDatabase(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  flushToDisk();
  db?.close();
  db = null;
}

/** Runs a statement with bound parameters. Never interpolate values into SQL. */
export function run(sql: string, params: BindParams = []): void {
  const stmt = requireDb().prepare(sql);
  try {
    stmt.run(params);
  } finally {
    stmt.free();
  }
  schedulePersist();
}

export function all<T = Record<string, SqlValue>>(sql: string, params: BindParams = []): T[] {
  const stmt = requireDb().prepare(sql);
  const rows: T[] = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
  } finally {
    stmt.free();
  }
  return rows;
}

export function get<T = Record<string, SqlValue>>(sql: string, params: BindParams = []): T | null {
  const rows = all<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function transaction(fn: () => void): void {
  const handle = requireDb();
  handle.run('BEGIN TRANSACTION;');
  try {
    fn();
    handle.run('COMMIT;');
  } catch (err) {
    handle.run('ROLLBACK;');
    throw err;
  }
  schedulePersist();
}

export function lastInsertId(): number {
  const row = get<{ id: SqlValue }>('SELECT last_insert_rowid() AS id');
  return Number(row?.id ?? 0);
}

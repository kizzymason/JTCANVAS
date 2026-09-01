import { all, run } from './index';
import type { RegistrationLog } from '../types';

interface LogRow {
  id: number;
  account_id: number | null;
  level: string;
  message: string;
  created_at: string;
}

function mapRow(row: LogRow): RegistrationLog {
  return {
    id: row.id,
    accountId: row.account_id,
    level: row.level as RegistrationLog['level'],
    message: row.message,
    createdAt: row.created_at,
  };
}

export function addLog(
  accountId: number | null,
  level: RegistrationLog['level'],
  message: string,
): void {
  run('INSERT INTO registration_logs (account_id, level, message) VALUES (?, ?, ?)', [
    accountId,
    level,
    message.slice(0, 1200),
  ]);
}

export function listLogs(accountId: number, limit = 200): RegistrationLog[] {
  return all<LogRow>(
    'SELECT * FROM registration_logs WHERE account_id = ? ORDER BY id DESC LIMIT ?',
    [accountId, limit],
  ).map(mapRow);
}

export function listRecentLogs(limit = 300): RegistrationLog[] {
  return all<LogRow>('SELECT * FROM registration_logs ORDER BY id DESC LIMIT ?', [limit]).map(mapRow);
}

export function clearLogs(): void {
  run('DELETE FROM registration_logs');
}

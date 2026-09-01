import { Router } from 'express';
import * as accountsRepo from '../db/accounts';
import type { Account, AccountStatus } from '../types';

const router = Router();

const VALID_STATUSES: AccountStatus[] = ['pending', 'running', 'completed', 'failed'];

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function selectAccounts(statusParam: unknown): Account[] {
  const status = typeof statusParam === 'string' && VALID_STATUSES.includes(statusParam as AccountStatus)
    ? (statusParam as AccountStatus)
    : undefined;
  return accountsRepo.listAccounts(status);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

router.get('/csv', (req, res) => {
  const includePasswords = req.query.includePasswords === 'true';
  const accounts = selectAccounts(req.query.status);

  const headers = [
    'ID',
    'Username',
    ...(includePasswords ? ['Password', 'TOTP Secret', 'Recovery Email'] : []),
    'Status',
    'API Key',
    'Cookie Token',
    'Attempts',
    'Last Error',
    'Created At',
  ];

  const rows = accounts.map((acc) =>
    [
      acc.id,
      acc.username,
      ...(includePasswords ? [acc.password, acc.totpSecret, acc.recoveryEmail] : []),
      acc.status,
      acc.apiKey ?? '',
      acc.cookieToken ?? '',
      acc.attempts,
      acc.lastError ?? '',
      acc.createdAt,
    ]
      .map(csvEscape)
      .join(','),
  );

  // The BOM makes Excel read the file as UTF-8 instead of the local ANSI codepage.
  const csv = `\uFEFF${[headers.join(','), ...rows].join('\r\n')}`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="piapi_accounts_${timestamp()}.csv"`);
  res.send(csv);
});

router.get('/json', (req, res) => {
  const includePasswords = req.query.includePasswords === 'true';
  const accounts = selectAccounts(req.query.status);
  const payload = includePasswords ? accounts : accounts.map(accountsRepo.stripPassword);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="piapi_accounts_${timestamp()}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

/** Round-trips the unambiguous four-field format the importer accepts. */
router.get('/txt', (req, res) => {
  const accounts = selectAccounts(req.query.status);
  const body = accounts
    .map((a) => `${a.username}----${a.password}----${a.totpSecret}----${a.recoveryEmail}`)
    .join('\r\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="piapi_accounts_${timestamp()}.txt"`);
  res.send(body);
});

export default router;

import { Router } from 'express';
import * as accountsRepo from '../db/accounts';
import * as logsRepo from '../db/logs';
import { parseAccountLines } from '../services/parse-accounts';
import { generateCode, isValidSecret, normalizeSecret, secondsRemaining } from '../services/totp';
import { isRunning } from '../services/queue';
import { syncAccountPiApiKey } from '../services/piapi-key';
import { condenseError } from '../services/errors';
import { getSettings } from '../db/settings';
import { emitEvent } from '../events';
import type { Account, AccountStatus, SafeAccount } from '../types';

const router = Router();

const VALID_STATUSES: AccountStatus[] = ['pending', 'running', 'completed', 'failed'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const apiKeySyncing = new Set<number>();

async function syncApiKey(account: Account): Promise<SafeAccount> {
  if (apiKeySyncing.has(account.id)) {
    throw new Error(`API key sync is already running for account ${account.id}`);
  }

  apiKeySyncing.add(account.id);
  logsRepo.addLog(account.id, 'info', 'Synchronizing PiAPI API key');
  try {
    const result = await syncAccountPiApiKey(account, getSettings());
    const updated = accountsRepo.updateAccount(account.id, { apiKey: result.apiKey });
    if (!updated) throw new Error('Account was removed while its API key was being synchronized');

    logsRepo.addLog(
      account.id,
      'success',
      result.created
        ? `Created and saved PiAPI API key "${result.keyName}"`
        : `Extracted and saved PiAPI API key "${result.keyName}"`,
    );
    const safe = accountsRepo.stripPassword(updated);
    emitEvent({ type: 'account', payload: safe });
    return safe;
  } catch (err) {
    const message = condenseError(err);
    logsRepo.addLog(account.id, 'error', `API key synchronization failed: ${message}`);
    throw new Error(message);
  } finally {
    apiKeySyncing.delete(account.id);
  }
}

router.get('/', (req, res) => {
  const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
  const status = VALID_STATUSES.includes(statusParam as AccountStatus)
    ? (statusParam as AccountStatus)
    : undefined;

  const accounts = accountsRepo.listAccounts(status).map(accountsRepo.stripPassword);
  res.json({ accounts, counts: accountsRepo.countByStatus() });
});

router.get('/counts', (_req, res) => {
  res.json(accountsRepo.countByStatus());
});

router.post('/api-keys/sync', async (req, res) => {
  if (isRunning()) {
    return res.status(409).json({ error: 'Stop the registration queue before synchronizing API keys' });
  }

  const ids = req.body?.ids;
  const force = req.body?.force === true;
  if (
    ids !== undefined &&
    (!Array.isArray(ids) ||
      ids.length === 0 ||
      ids.some((id) => typeof id !== 'number' || !Number.isInteger(id) || id <= 0))
  ) {
    return res.status(400).json({ error: 'ids must be a non-empty array of positive integers' });
  }

  const requested = ids
    ? [...new Set<number>(ids)].map((id) => accountsRepo.getAccount(id))
    : accountsRepo.listAccounts('completed').filter((account) => !account.apiKey);

  const result: {
    requested: number;
    synced: number;
    skipped: number;
    failed: number;
    accounts: SafeAccount[];
    errors: Array<{ id: number; username: string; error: string }>;
  } = {
    requested: requested.length,
    synced: 0,
    skipped: 0,
    failed: 0,
    accounts: [],
    errors: [],
  };

  // Persistent Chromium profiles cannot be opened twice. Serial processing is
  // also intentionally gentler on PiAPI than firing a burst of reveal calls.
  for (const account of requested) {
    if (!account) {
      result.failed += 1;
      result.errors.push({ id: 0, username: '', error: 'Account not found' });
      continue;
    }
    if (account.status !== 'completed') {
      result.failed += 1;
      result.errors.push({
        id: account.id,
        username: account.username,
        error: 'Account has not completed PiAPI registration',
      });
      continue;
    }
    if (account.apiKey && !force) {
      result.skipped += 1;
      result.accounts.push(accountsRepo.stripPassword(account));
      continue;
    }

    try {
      result.accounts.push(await syncApiKey(account));
      result.synced += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        id: account.id,
        username: account.username,
        error: condenseError(err),
      });
    }
  }

  res.json(result);
});

router.post('/:id/api-key', async (req, res) => {
  if (isRunning()) {
    return res.status(409).json({ error: 'Stop the registration queue before synchronizing an API key' });
  }

  const id = Number(req.params.id);
  const account = Number.isInteger(id) ? accountsRepo.getAccount(id) : null;
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.status !== 'completed') {
    return res.status(409).json({ error: 'The account has not completed PiAPI registration' });
  }

  try {
    res.json({ account: await syncApiKey(account) });
  } catch (err) {
    res.status(502).json({ error: `Could not obtain the PiAPI API key: ${condenseError(err)}` });
  }
});

router.post('/', (req, res) => {
  const { username, password, totpSecret = '', recoveryEmail = '' } = req.body ?? {};

  if (typeof username !== 'string' || !EMAIL_RE.test(username.trim())) {
    return res.status(400).json({ error: 'username must be a complete Google email address' });
  }
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'password is required' });
  }
  if (typeof totpSecret !== 'string' || (totpSecret && !isValidSecret(totpSecret))) {
    return res.status(400).json({ error: 'totpSecret must be empty or a valid base32 secret' });
  }
  if (typeof recoveryEmail !== 'string' || (recoveryEmail && !EMAIL_RE.test(recoveryEmail))) {
    return res.status(400).json({ error: 'recoveryEmail must be empty or a valid email address' });
  }
  if (!totpSecret && !recoveryEmail) {
    return res.status(400).json({ error: 'A TOTP secret or recovery email is required' });
  }
  if (accountsRepo.findByUsername(username.trim())) {
    return res.status(409).json({ error: `Account "${username.trim()}" already exists` });
  }

  const account = accountsRepo.createAccount({
    username: username.trim(),
    password,
    totpSecret: totpSecret ? normalizeSecret(totpSecret) : '',
    recoveryEmail: recoveryEmail.trim().toLowerCase(),
  });
  logsRepo.addLog(account.id, 'info', 'Account added manually');
  emitEvent({ type: 'account', payload: accountsRepo.stripPassword(account) });

  res.status(201).json(accountsRepo.stripPassword(account));
});

/** Accepts raw pasted text and reports per-line failures instead of rejecting the batch. */
router.post('/bulk', (req, res) => {
  const body = req.body ?? {};
  const text =
    typeof body === 'string'
      ? body
      : typeof body.text === 'string'
        ? body.text
        : Array.isArray(body)
          ? body
              .map(
                (a: Record<string, unknown>) =>
                  `${a.username}----${a.password}----${a.totpSecret ?? ''}----${a.recoveryEmail ?? ''}`,
              )
              .join('\n')
          : '';

  if (!text.trim()) {
    return res.status(400).json({ error: 'No account data supplied' });
  }

  const report = parseAccountLines(text);
  if (report.accounts.length === 0) {
    return res.status(400).json({
      error: 'No valid accounts could be parsed',
      total: report.total,
      errors: report.errors,
    });
  }

  const result = accountsRepo.bulkUpsert(report.accounts);
  logsRepo.addLog(
    null,
    'info',
    `Bulk import: ${result.inserted} added, ${result.updated} updated, ${result.skipped} unchanged, ${report.errors.length} rejected`,
  );

  res.json({
    ...result,
    total: report.total,
    rejected: report.errors.length,
    errors: report.errors,
  });
});

/** Dry parse so the import dialog can preview the result before committing. */
router.post('/bulk/preview', (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const report = parseAccountLines(text);
  res.json({
    total: report.total,
    valid: report.accounts.length,
    errors: report.errors,
    preview: report.accounts.slice(0, 20).map((a) => ({
      username: a.username,
      passwordMasked: '*'.repeat(Math.min(a.password.length, 12)),
      totpSecret: a.totpSecret,
      recoveryEmail: a.recoveryEmail,
    })),
  });
});

router.get('/:id', (req, res) => {
  const account = accountsRepo.getAccount(Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'Account not found' });
  res.json(accountsRepo.stripPassword(account));
});

router.get('/:id/logs', (req, res) => {
  const id = Number(req.params.id);
  if (!accountsRepo.getAccount(id)) return res.status(404).json({ error: 'Account not found' });
  res.json(logsRepo.listLogs(id));
});

router.get('/:id/totp', (req, res) => {
  const account = accountsRepo.getAccount(Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    res.json({ code: generateCode(account.totpSecret), secondsRemaining: secondsRemaining() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid TOTP secret' });
  }
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!accountsRepo.getAccount(id)) return res.status(404).json({ error: 'Account not found' });

  const { username, password, totpSecret, recoveryEmail, status } = req.body ?? {};
  const updates: accountsRepo.AccountUpdate = {};

  if (typeof username === 'string') {
    if (!EMAIL_RE.test(username.trim())) {
      return res.status(400).json({ error: 'username must be a complete Google email address' });
    }
    updates.username = username.trim();
  }
  if (typeof password === 'string' && password) updates.password = password;
  if (typeof totpSecret === 'string') {
    if (totpSecret && !isValidSecret(totpSecret)) {
      return res.status(400).json({ error: 'totpSecret must be empty or a valid base32 secret' });
    }
    updates.totpSecret = totpSecret ? normalizeSecret(totpSecret) : '';
  }
  if (typeof recoveryEmail === 'string') {
    if (recoveryEmail && !EMAIL_RE.test(recoveryEmail)) {
      return res.status(400).json({ error: 'recoveryEmail must be empty or a valid email address' });
    }
    updates.recoveryEmail = recoveryEmail.trim().toLowerCase();
  }
  if (typeof status === 'string') {
    if (!VALID_STATUSES.includes(status as AccountStatus)) {
      return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
    }
    updates.status = status as AccountStatus;
  }

  const updated = accountsRepo.updateAccount(id, updates);
  if (updated) emitEvent({ type: 'account', payload: accountsRepo.stripPassword(updated) });
  res.json(updated ? accountsRepo.stripPassword(updated) : null);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!accountsRepo.getAccount(id)) return res.status(404).json({ error: 'Account not found' });
  if (isRunning()) return res.status(409).json({ error: 'Stop the running queue before deleting accounts' });

  accountsRepo.deleteAccount(id);
  res.json({ deleted: 1 });
});

router.post('/bulk-delete', (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Stop the running queue before deleting accounts' });

  const { ids, status } = req.body ?? {};

  if (typeof status === 'string') {
    if (!VALID_STATUSES.includes(status as AccountStatus)) {
      return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
    }
    return res.json({ deleted: accountsRepo.deleteByStatus(status as AccountStatus) });
  }

  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'number')) {
    return res.status(400).json({ error: 'ids must be an array of numbers' });
  }

  res.json({ deleted: accountsRepo.deleteAccounts(ids) });
});

router.post('/reset', (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Stop the running queue first' });

  const from = typeof req.body?.from === 'string' ? req.body.from : 'failed';
  if (!VALID_STATUSES.includes(from as AccountStatus)) {
    return res.status(400).json({ error: `from must be one of ${VALID_STATUSES.join(', ')}` });
  }

  const reset = accountsRepo.resetStatuses(from as AccountStatus, 'pending');
  logsRepo.addLog(null, 'info', `Reset ${reset} "${from}" account(s) back to pending`);
  res.json({ reset });
});

export default router;

import * as accountsRepo from '../db/accounts';
import * as logsRepo from '../db/logs';
import { getSettings } from '../db/settings';
import { emitEvent } from '../events';
import { registerAccount } from './registrar';
import { condenseError } from './errors';
import type { Account, QueueProgress, RegistrationLog } from '../types';

interface QueueState {
  running: boolean;
  total: number;
  processed: number;
  success: number;
  failed: number;
  active: Map<number, string>;
  abort: { aborted: boolean };
}

const state: QueueState = {
  running: false,
  total: 0,
  processed: 0,
  success: 0,
  failed: 0,
  active: new Map(),
  abort: { aborted: false },
};

export function getProgress(): QueueProgress {
  return {
    running: state.running,
    total: state.total,
    processed: state.processed,
    success: state.success,
    failed: state.failed,
    active: [...state.active.values()],
  };
}

function broadcastProgress(): void {
  emitEvent({ type: 'progress', payload: getProgress() });
}

function logFor(account: Account) {
  return (level: RegistrationLog['level'], message: string): void => {
    logsRepo.addLog(account.id, level, message);
    emitEvent({
      type: 'log',
      payload: {
        accountId: account.id,
        username: account.username,
        level,
        message,
        at: new Date().toISOString(),
      },
    });
  };
}

function pushAccount(id: number): void {
  const fresh = accountsRepo.getAccount(id);
  if (fresh) {
    emitEvent({ type: 'account', payload: accountsRepo.stripPassword(fresh) });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function processAccount(account: Account): Promise<void> {
  const settings = getSettings();
  const log = logFor(account);

  state.active.set(account.id, account.username);
  accountsRepo.updateAccount(account.id, { status: 'running', lastError: null });
  pushAccount(account.id);
  broadcastProgress();

  let attempt = 0;
  let lastMessage = 'Unknown error';
  let lastScreenshot: string | null = null;

  while (attempt <= settings.maxRetries && !state.abort.aborted) {
    if (attempt > 0) {
      const backoff = Math.min(30000, 2000 * 2 ** (attempt - 1));
      log('warn', `Retry ${attempt}/${settings.maxRetries} in ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      if (state.abort.aborted) break;
    }

    attempt += 1;
    accountsRepo.updateAccount(account.id, { attempts: attempt });

    try {
      const outcome = await registerAccount(account, settings, log, state.abort);
      if (outcome.success) {
        accountsRepo.updateAccount(account.id, {
          status: 'completed',
          // A transient key-endpoint failure must not erase a key captured by
          // an earlier successful run.
          apiKey: outcome.apiKey ?? account.apiKey,
          cookieToken: outcome.cookieToken,
          lastError: null,
          screenshotPath: null,
        });
        state.success += 1;
        state.processed += 1;
        state.active.delete(account.id);
        pushAccount(account.id);
        broadcastProgress();
        return;
      }
      lastMessage = outcome.message;
      lastScreenshot = outcome.screenshot;

      if (outcome.retryable === false) {
        log('warn', 'This failure is permanent, skipping the remaining retries');
        break;
      }
    } catch (err) {
      lastMessage = condenseError(err);
      log('error', lastMessage);
    }
  }

  const finalMessage = state.abort.aborted ? 'Cancelled by the operator' : condenseError(lastMessage);
  accountsRepo.updateAccount(account.id, {
    status: state.abort.aborted ? 'pending' : 'failed',
    lastError: finalMessage,
    screenshotPath: lastScreenshot,
  });
  if (!state.abort.aborted) {
    state.failed += 1;
    logsRepo.addLog(account.id, 'error', `Giving up after ${attempt} attempt(s): ${finalMessage}`);
  }
  state.processed += 1;
  state.active.delete(account.id);
  pushAccount(account.id);
  broadcastProgress();
}

async function worker(queue: Account[]): Promise<void> {
  while (!state.abort.aborted) {
    const next = queue.shift();
    if (!next) return;
    await processAccount(next);
  }
}

export interface StartResult {
  started: boolean;
  total: number;
  reason?: string;
}

export async function startQueue(accountIds?: number[]): Promise<StartResult> {
  if (state.running) {
    return { started: false, total: 0, reason: 'A registration run is already in progress' };
  }

  const settings = getSettings();
  const candidates = (
    accountIds && accountIds.length > 0
      ? accountIds.map((id) => accountsRepo.getAccount(id)).filter((a): a is Account => a !== null)
      : accountsRepo.listAccounts('pending')
  ).filter((a) => a.status !== 'completed');

  if (candidates.length === 0) {
    return { started: false, total: 0, reason: 'No pending accounts to process' };
  }

  state.running = true;
  state.total = candidates.length;
  state.processed = 0;
  state.success = 0;
  state.failed = 0;
  state.active.clear();
  state.abort = { aborted: false };

  logsRepo.addLog(
    null,
    'info',
    `Queue started: ${candidates.length} account(s), concurrency ${settings.maxConcurrent}${settings.dryRun ? ', DRY-RUN' : ''}`,
  );
  broadcastProgress();

  const queue = [...candidates];
  const workers = Array.from({ length: Math.min(settings.maxConcurrent, queue.length) }, () =>
    worker(queue),
  );

  // Deliberately not awaited by the caller: the HTTP request returns immediately
  // and the browser follows along over SSE.
  void Promise.all(workers)
    .catch((err) => {
      logsRepo.addLog(null, 'error', `Queue crashed: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      state.running = false;
      state.active.clear();
      logsRepo.addLog(
        null,
        'info',
        `Queue finished: ${state.success} succeeded, ${state.failed} failed`,
      );
      broadcastProgress();
      emitEvent({ type: 'queue-finished', payload: getProgress() });
    });

  return { started: true, total: candidates.length };
}

export function stopQueue(): { stopped: boolean } {
  if (!state.running) return { stopped: false };
  state.abort.aborted = true;
  logsRepo.addLog(null, 'warn', 'Stop requested; finishing the in-flight accounts');
  broadcastProgress();
  return { stopped: true };
}

export function isRunning(): boolean {
  return state.running;
}

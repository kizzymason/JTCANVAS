import { openSession, Session } from './browser';
import { getSettings } from '../db/settings';
import { getAccount } from '../db/accounts';
import { addLog } from '../db/logs';
import { emitEvent } from '../events';

let current: Session | null = null;
let openedAt: number | null = null;
let currentAccountId: number | null = null;

/** Opens the selected account's real persistent profile for manual Google challenges. */
export async function openAuthSession(accountId: number): Promise<{ url: string; accountId: number }> {
  const account = getAccount(accountId);
  if (!account) throw new Error('Account not found');

  if (current) {
    if (currentAccountId !== accountId) {
      throw new Error(`The noVNC assistant is already open for account ${currentAccountId}`);
    }
    return { url: current.page.url(), accountId };
  }

  const settings = getSettings();
  const session = await openSession(settings, { profileKey: `account-${accountId}` });
  current = session;
  openedAt = Date.now();
  currentAccountId = accountId;

  try {
    await session.page.goto(settings.piapiWorkspaceUrl, { waitUntil: 'domcontentloaded' });
  } catch {
    /* the operator can navigate manually if the initial load fails */
  }

  addLog(accountId, 'info', 'Manual Google challenge assistant opened');
  emitEvent({
    type: 'auth-session',
    payload: {
      active: true,
      accountId,
      message: `Browser is live for ${account.username}; complete the Google/PiAPI challenge in noVNC`,
    },
  });

  return { url: session.page.url(), accountId };
}

export async function completeAuthSession(): Promise<{ saved: boolean; cookies: number }> {
  if (!current) {
    return { saved: false, cookies: 0 };
  }

  const cookies = await current.context.cookies();
  const accountId = currentAccountId;
  await current.close();
  current = null;
  openedAt = null;
  currentAccountId = null;

  addLog(accountId, 'success', `Manual Google session retained in the account profile (${cookies.length} cookies)`);
  emitEvent({
    type: 'auth-session',
    payload: {
      active: false,
      accountId,
      message: `Account profile saved with ${cookies.length} cookies`,
    },
  });

  return { saved: true, cookies: cookies.length };
}

export async function cancelAuthSession(): Promise<void> {
  if (!current) return;
  const accountId = currentAccountId;
  await current.close();
  current = null;
  openedAt = null;
  currentAccountId = null;
  addLog(accountId, 'warn', 'Manual Google challenge assistant closed');
  emitEvent({ type: 'auth-session', payload: { active: false, accountId, message: 'Assistant closed' } });
}

export function authSessionStatus(): {
  active: boolean;
  accountId: number | null;
  openedAt: string | null;
  url: string | null;
} {
  return {
    active: current !== null,
    accountId: currentAccountId,
    openedAt: openedAt ? new Date(openedAt).toISOString() : null,
    url: current ? current.page.url() : null,
  };
}

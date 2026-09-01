import { Router } from 'express';
import { getSettings, saveSettings, resetSettings } from '../db/settings';
import { defaultSettings } from '../config';
import {
  clearBrowserData,
  clearQueueProfiles,
  clearScreenshots,
  listScreenshots,
  openSession,
} from '../services/browser';
import { testEntry, testPool } from '../services/proxy';
import { isRunning } from '../services/queue';
import * as accountsRepo from '../db/accounts';
import * as logsRepo from '../db/logs';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ settings: getSettings(), defaults: defaultSettings });
});

router.put('/', (req, res) => {
  if (typeof req.body !== 'object' || req.body === null) {
    return res.status(400).json({ error: 'Expected a settings object' });
  }
  res.json({ settings: saveSettings(req.body as Record<string, unknown>) });
});

router.post('/reset', (_req, res) => {
  res.json({ settings: resetSettings() });
});

/** Checks every entry in the pool, enabled or not, without launching a browser. */
router.post('/proxy-test', async (_req, res, next) => {
  try {
    res.json({ results: await testPool(getSettings()) });
  } catch (err) {
    next(err);
  }
});

/** Checks one entry, so a single edited row can be verified on its own. */
router.post('/proxy-test/:id', async (req, res, next) => {
  try {
    const entry = getSettings().proxyPool.entries.find((e) => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'No proxy with that id' });
    res.json({ result: await testEntry(entry) });
  } catch (err) {
    next(err);
  }
});

/**
 * Opens a real browser and asks what address it came from. Unlike the pool
 * test this exercises the exact path a registration run takes — Chromium, the
 * selected pool entry, the substituted session token — so it is the only way
 * to prove what a queued account will actually egress from.
 */
router.get('/egress-ip', async (req, res, next) => {
  if (isRunning()) return res.status(409).json({ error: 'Stop the running queue first' });

  const profileKey = typeof req.query.profileKey === 'string' ? req.query.profileKey : 'egress-check';
  let session: Awaited<ReturnType<typeof openSession>> | null = null;
  try {
    session = await openSession(getSettings(), { profileKey: 'egress-check', proxyKey: profileKey });
    await session.page.goto('https://ipinfo.io/json', { waitUntil: 'domcontentloaded' });
    const body = await session.page.locator('pre, body').first().innerText();

    const info = JSON.parse(body) as Record<string, string>;
    res.json({
      ip: info.ip ?? null,
      city: info.city ?? null,
      country: info.country ?? null,
      org: info.org ?? null,
      // Reported by the session itself rather than resolved a second time, so
      // round-robin cannot report one entry while the browser used another.
      proxyConfigured: Boolean(session.proxy),
      proxyLabel: session.proxy?.label ?? null,
      profileKey,
    });
  } catch (err) {
    next(err);
  } finally {
    await session?.close();
  }
});

router.post('/clear-completed', (_req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Stop the running queue first' });
  const deleted = accountsRepo.deleteByStatus('completed');
  logsRepo.addLog(null, 'warn', `Deleted ${deleted} completed account(s)`);
  res.json({ deleted });
});

router.post('/clear-browser', (_req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Stop the running queue first' });
  clearBrowserData();
  logsRepo.addLog(null, 'warn', 'All browser profiles cleared');
  res.json({ cleared: true });
});

router.post('/clear-profiles', (_req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Stop the running queue first' });
  const deleted = clearQueueProfiles();
  logsRepo.addLog(null, 'warn', `Deleted ${deleted} per-account browser profile(s)`);
  res.json({ deleted });
});

router.post('/clear-logs', (_req, res) => {
  logsRepo.clearLogs();
  res.json({ cleared: true });
});

router.post('/clear-screenshots', (_req, res) => {
  res.json({ deleted: clearScreenshots() });
});

router.get('/screenshots', (_req, res) => {
  res.json({ screenshots: listScreenshots() });
});

export default router;

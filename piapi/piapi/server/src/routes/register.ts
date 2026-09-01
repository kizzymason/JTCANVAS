import { Router } from 'express';
import { startQueue, stopQueue, getProgress } from '../services/queue';
import {
  openAuthSession,
  completeAuthSession,
  cancelAuthSession,
  authSessionStatus,
} from '../services/auth-session';
import { generateCode, secondsRemaining } from '../services/totp';
import { getAccount } from '../db/accounts';
import { env } from '../config';

const router = Router();

router.get('/status', (_req, res) => {
  res.json({
    progress: getProgress(),
    authSession: authSessionStatus(),
    novncUrl: env.novncUrl,
  });
});

router.post('/start', async (req, res, next) => {
  try {
    if (authSessionStatus().active) {
      return res.status(409).json({ error: 'Close the noVNC account assistant before starting the queue' });
    }

    const raw: unknown = req.body?.accountIds;
    if (raw !== undefined && !Array.isArray(raw)) {
      return res.status(400).json({ error: 'accountIds must be an array of numbers' });
    }

    // Omitting the field means "every pending account". An explicitly empty
    // array is a caller bug — treating it as "everything" would silently start
    // a full run when the intent was to start none.
    const ids = Array.isArray(raw)
      ? raw.filter((id: unknown): id is number => typeof id === 'number')
      : undefined;
    if (ids && ids.length === 0) {
      return res.status(400).json({ error: 'accountIds was empty; omit it entirely to run all pending accounts' });
    }

    const result = await startQueue(ids);
    if (!result.started) return res.status(409).json({ error: result.reason });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/stop', (_req, res) => {
  const result = stopQueue();
  if (!result.stopped) return res.status(409).json({ error: 'No registration run is in progress' });
  res.json(result);
});

router.post('/auth-session', async (req, res, next) => {
  try {
    if (getProgress().running) {
      return res.status(409).json({ error: 'Stop the registration queue before opening the noVNC assistant' });
    }

    const accountId = Number(req.body?.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ error: 'accountId must be a positive integer' });
    }
    if (!getAccount(accountId)) return res.status(404).json({ error: 'Account not found' });

    const result = await openAuthSession(accountId);
    res.json({ ...result, novncUrl: env.novncUrl, status: authSessionStatus() });
  } catch (err) {
    next(err);
  }
});

router.post('/auth-session/complete', async (_req, res, next) => {
  try {
    const result = await completeAuthSession();
    if (!result.saved) return res.status(409).json({ error: 'No manual authorization session is open' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/auth-session', async (_req, res, next) => {
  try {
    await cancelAuthSession();
    res.json({ cancelled: true });
  } catch (err) {
    next(err);
  }
});

router.post('/verify-totp', (req, res) => {
  const secret = typeof req.body?.secret === 'string' ? req.body.secret : '';
  if (!secret) return res.status(400).json({ error: 'secret is required' });

  try {
    res.json({ code: generateCode(secret), secondsRemaining: secondsRemaining() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid TOTP secret' });
  }
});

export default router;

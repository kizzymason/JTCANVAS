import { Router } from 'express';
import express from 'express';
import accountsRouter from './accounts';
import registerRouter from './register';
import settingsRouter from './settings';
import exportRouter from './export';
import { addSseClient } from '../events';
import { listRecentLogs } from '../db/logs';
import { getProgress } from '../services/queue';
import { paths, env } from '../config';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), inContainer: env.inContainer });
});

router.get('/events', (req, res) => {
  const cleanup = addSseClient(res);
  req.on('close', cleanup);
});

router.get('/logs', (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 300));
  res.json({ logs: listRecentLogs(limit) });
});

router.get('/progress', (_req, res) => {
  res.json(getProgress());
});

router.use('/accounts', accountsRouter);
router.use('/register', registerRouter);
router.use('/settings', settingsRouter);
router.use('/export', exportRouter);
router.use('/screenshots', express.static(paths.screenshots, { fallthrough: true, maxAge: '1h' }));

export default router;

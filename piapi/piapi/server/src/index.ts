import express from 'express';
import cors from 'cors';
import { env } from './config';
import { initDatabase, closeDatabase } from './db';
import apiRouter from './routes';
import { cancelAuthSession } from './services/auth-session';

async function main(): Promise<void> {
  // Every route touches the database, so nothing may listen until it is ready.
  await initDatabase();
  console.log('[db] ready');

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '20mb' }));
  app.use(express.text({ limit: '20mb', type: 'text/plain' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api', apiRouter);

  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[error]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`[api] listening on http://0.0.0.0:${env.port}`);
    if (env.display) console.log(`[api] Playwright renders on DISPLAY=${env.display}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close();
    await cancelAuthSession().catch(() => undefined);
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[fatal] failed to start:', err);
  process.exit(1);
});

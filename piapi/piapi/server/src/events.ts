import { EventEmitter } from 'events';
import type { Response } from 'express';
import type { ServerEvent } from './types';

const bus = new EventEmitter();
bus.setMaxListeners(0);

const clients = new Set<Response>();

export function emitEvent(event: ServerEvent): void {
  bus.emit('event', event);
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    res.write(frame);
  }
}

export function addSseClient(res: Response): () => void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Tells nginx not to buffer the stream even if proxy_buffering is left on.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(': connected\n\n');

  clients.add(res);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 20000);

  return () => {
    clearInterval(heartbeat);
    clients.delete(res);
  };
}

export function clientCount(): number {
  return clients.size;
}

export { bus };

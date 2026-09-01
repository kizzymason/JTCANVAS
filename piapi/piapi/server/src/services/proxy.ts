import { request } from 'playwright';
import type { AppSettings, ProxyEntry, ProxyTestResult } from '../types';

export interface ResolvedProxy {
  server: string;
  username?: string;
  password?: string;
  /** Which pool entry this came from, for logging. */
  label: string;
}

let roundRobinCursor = 0;

/**
 * Turns a profile key such as `account-7` into a token a proxy vendor will
 * accept inside the username field: letters and digits only, bounded length.
 */
function sessionToken(profileKey: string): string {
  return profileKey.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'default';
}

/** FNV-1a: small, dependency-free, and stable across restarts. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function parseProxyUrl(raw: string): Omit<ResolvedProxy, 'label'> | null {
  const value = raw.trim();
  if (!value) return null;

  try {
    const url = new URL(/^\w+:\/\//.test(value) ? value : `http://${value}`);
    if (!url.hostname) return null;

    const proxy: Omit<ResolvedProxy, 'label'> = { server: `${url.protocol}//${url.host}` };
    if (url.username) proxy.username = decodeURIComponent(url.username);
    if (url.password) proxy.password = decodeURIComponent(url.password);
    return proxy;
  } catch {
    return null;
  }
}

export function usableEntries(settings: AppSettings): ProxyEntry[] {
  const pool = settings.proxyPool;
  if (!pool?.enabled) return [];
  return pool.entries.filter((entry) => entry.enabled && entry.url.trim());
}

/** Substitutes `{session}` and parses. Exported so the tester shares the logic. */
export function buildProxy(entry: ProxyEntry, profileKey: string): ResolvedProxy | null {
  const url = entry.url.replace(/\{session\}/g, sessionToken(profileKey));
  const parsed = parseProxyUrl(url);
  return parsed ? { ...parsed, label: entry.label || entry.id } : null;
}

export function resolveProxy(settings: AppSettings, profileKey: string): ResolvedProxy | null {
  const entries = usableEntries(settings);
  if (entries.length === 0) return null;

  let entry: ProxyEntry;
  switch (settings.proxyPool.strategy) {
    case 'round-robin':
      entry = entries[roundRobinCursor % entries.length];
      roundRobinCursor += 1;
      break;
    case 'random':
      entry = entries[Math.floor(Math.random() * entries.length)];
      break;
    case 'per-account':
    default:
      entry = entries[hash(profileKey) % entries.length];
      break;
  }

  return buildProxy(entry, profileKey);
}

/**
 * Checks an entry with a plain HTTP request rather than a browser launch:
 * same proxy stack, a fraction of the cost, so testing a whole pool stays fast.
 */
export async function testEntry(entry: ProxyEntry, profileKey = 'pooltest'): Promise<ProxyTestResult> {
  const base: ProxyTestResult = {
    id: entry.id,
    label: entry.label || entry.id,
    ok: false,
    ip: null,
    org: null,
    country: null,
    latencyMs: 0,
    error: null,
  };

  const proxy = buildProxy(entry, profileKey);
  if (!proxy) return { ...base, error: 'Could not parse the proxy URL' };

  const started = Date.now();
  let context: Awaited<ReturnType<typeof request.newContext>> | null = null;
  try {
    context = await request.newContext({
      proxy: { server: proxy.server, username: proxy.username, password: proxy.password },
      ignoreHTTPSErrors: true,
      timeout: 45000,
    });
    const response = await context.get('https://ipinfo.io/json', { timeout: 45000 });
    if (!response.ok()) {
      return { ...base, latencyMs: Date.now() - started, error: `HTTP ${response.status()}` };
    }

    const info = (await response.json()) as Record<string, string>;
    return {
      ...base,
      ok: true,
      ip: info.ip ?? null,
      org: info.org ?? null,
      country: info.country ?? null,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ...base,
      latencyMs: Date.now() - started,
      error: (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 160),
    };
  } finally {
    await context?.dispose().catch(() => undefined);
  }
}

export async function testPool(settings: AppSettings): Promise<ProxyTestResult[]> {
  const entries = settings.proxyPool?.entries ?? [];
  // Sequential on purpose: a shared residential gateway rate-limits parallel
  // probes and would report healthy entries as dead.
  const results: ProxyTestResult[] = [];
  for (const entry of entries) {
    results.push(await testEntry(entry));
  }
  return results;
}

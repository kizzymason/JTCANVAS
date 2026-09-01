import { get, run } from './index';
import { defaultSettings } from '../config';
import type {
  AppSettings,
  ProxyEntry,
  ProxyPool,
  ProxyStrategy,
  SelectorSet,
} from '../types';

const SETTINGS_KEY = 'app';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const STRATEGIES: ProxyStrategy[] = ['per-account', 'round-robin', 'random'];

/**
 * Normalises the pool and, for databases written before the pool existed,
 * lifts the old single `proxyUrl` into it so a configured proxy is not lost.
 */
function mergeProxyPool(stored: Record<string, unknown>): ProxyPool {
  const raw = stored.proxyPool;

  if (!isPlainObject(raw)) {
    const legacy = typeof stored.proxyUrl === 'string' ? stored.proxyUrl.trim() : '';
    if (!legacy) return { ...defaultSettings.proxyPool, entries: [] };
    return {
      enabled: true,
      strategy: 'per-account',
      entries: [{ id: 'legacy', label: 'Imported from the old single-proxy setting', url: legacy, enabled: true }],
    };
  }

  const entries: ProxyEntry[] = Array.isArray(raw.entries)
    ? raw.entries
        .filter(isPlainObject)
        .map((entry, index) => ({
          id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `proxy-${index + 1}`,
          label: typeof entry.label === 'string' ? entry.label.trim().slice(0, 80) : '',
          url: typeof entry.url === 'string' ? entry.url.trim() : '',
          enabled: entry.enabled !== false,
        }))
        .filter((entry) => entry.url)
    : [];

  const strategy = STRATEGIES.includes(raw.strategy as ProxyStrategy)
    ? (raw.strategy as ProxyStrategy)
    : 'per-account';

  // An empty pool cannot be "on": that would silently mean a direct connection
  // while the UI claims a proxy is in use. Older builds had a second
  // `directForGoogle` switch; migrate that state to the single pool on/off
  // switch so a known-incompatible proxy cannot suddenly become active.
  return {
    enabled: raw.enabled === true && raw.directForGoogle !== true && entries.length > 0,
    strategy,
    entries,
  };
}

/**
 * Merges stored settings over the defaults so that newly added keys (and new
 * selector candidates shipped in an update) appear without a manual migration.
 */
function merge(stored: Record<string, unknown>): AppSettings {
  const selectors: SelectorSet = { ...defaultSettings.selectors };
  if (isPlainObject(stored.selectors)) {
    const storedSelectors = stored.selectors as Record<string, unknown>;
    const asList = (value: unknown): string[] | null =>
      Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')
        ? (value as string[])
        : null;

    for (const key of Object.keys(defaultSettings.selectors) as Array<keyof SelectorSet>) {
      const value = asList(storedSelectors[key]);
      if (value) selectors[key] = value;
    }

  }

  const pickNumber = (key: keyof AppSettings, min: number, max: number): number => {
    const raw = Number(stored[key]);
    if (!Number.isFinite(raw)) return defaultSettings[key] as number;
    return Math.min(max, Math.max(min, Math.round(raw)));
  };

  const pickBoolean = (key: keyof AppSettings): boolean =>
    typeof stored[key] === 'boolean' ? (stored[key] as boolean) : (defaultSettings[key] as boolean);

  const pickString = (key: keyof AppSettings): string =>
    typeof stored[key] === 'string' && (stored[key] as string).trim()
      ? (stored[key] as string).trim()
      : (defaultSettings[key] as string);

  const proxyPool = mergeProxyPool(stored);

  const cookieTokenNames =
    Array.isArray(stored.cookieTokenNames) &&
    stored.cookieTokenNames.every((v) => typeof v === 'string') &&
    stored.cookieTokenNames.length > 0
      ? (stored.cookieTokenNames as string[])
      : defaultSettings.cookieTokenNames;

  return {
    maxConcurrent: pickNumber('maxConcurrent', 1, 10),
    maxRetries: pickNumber('maxRetries', 0, 5),
    navigationTimeoutMs: pickNumber('navigationTimeoutMs', 5000, 180000),
    actionTimeoutMs: pickNumber('actionTimeoutMs', 1000, 120000),
    headless: pickBoolean('headless'),
    dryRun: pickBoolean('dryRun'),
    proxyPool,
    piapiBaseUrl: pickString('piapiBaseUrl'),
    piapiWorkspaceUrl: pickString('piapiWorkspaceUrl'),
    cookieTokenNames,
    selectors,
  };
}

export function getSettings(): AppSettings {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [SETTINGS_KEY]);
  if (!row) return { ...defaultSettings };
  try {
    const parsed: unknown = JSON.parse(row.value);
    return isPlainObject(parsed) ? merge(parsed) : { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(patch: Record<string, unknown>): AppSettings {
  const next = merge({ ...(getSettings() as unknown as Record<string, unknown>), ...patch });
  run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_KEY, JSON.stringify(next)],
  );
  return next;
}

/**
 * Restores factory defaults but keeps the proxy pool: it holds purchased
 * credentials that are not recoverable from this app, and losing them to a
 * button whose stated job is "reset the selectors" would be a nasty surprise.
 */
export function resetSettings(): AppSettings {
  const { proxyPool } = getSettings();
  run('DELETE FROM settings WHERE key = ?', [SETTINGS_KEY]);
  return proxyPool.entries.length > 0
    ? saveSettings({ proxyPool: proxyPool as unknown as Record<string, unknown> })
    : { ...defaultSettings };
}

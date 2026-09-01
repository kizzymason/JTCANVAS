import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { paths, env } from '../config';
import { resolveProxy, type ResolvedProxy } from './proxy';
import type { AppSettings } from '../types';

const activeProfileDirs = new Set<string>();

export interface Session {
  context: BrowserContext;
  page: Page;
  /** Which pool entry this context egresses through, or null for a direct connection. */
  proxy: ResolvedProxy | null;
  close(): Promise<void>;
}

export interface SessionOptions {
  /**
   * Isolates one Chromium profile per caller. Chromium refuses to open the same
   * profile twice, and sharing one across accounts would carry account A's
   * Google/PiAPI cookies into account B's login.
   */
  profileKey: string;
  /**
   * Which key picks the proxy and seeds the sticky-session token. Defaults to
   * `profileKey`; the egress check overrides it so that it can use a throwaway
   * Chromium profile while still egressing exactly like the account it reports on.
   */
  proxyKey?: string;
}

function launchArgs(): string[] {
  return [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1280,800',
  ];
}

function profileDir(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  return path.join(paths.browserProfile, safe);
}

/**
 * A container that dies mid-run leaves these behind, and Chromium then refuses
 * to start with "profile appears to be in use by another Chromium process".
 */
function clearStaleLocks(dir: string): void {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
}

export function clearBrowserData(): void {
  fs.rmSync(paths.browserProfile, { recursive: true, force: true });
  fs.mkdirSync(paths.browserProfile, { recursive: true });
}

/** Removes every per-account registration profile. */
export function clearQueueProfiles(): number {
  if (!fs.existsSync(paths.browserProfile)) return 0;
  const victims = fs
    .readdirSync(paths.browserProfile)
    .filter((name) => name.startsWith('account-') || name.startsWith('worker-'));
  for (const name of victims) {
    fs.rmSync(path.join(paths.browserProfile, name), { recursive: true, force: true });
  }
  return victims.length;
}

/**
 * `launchPersistentContext` is what actually persists cookies; passing
 * `--user-data-dir` to `chromium.launch()` is ignored by Playwright.
 */
export async function openSession(settings: AppSettings, options: SessionOptions): Promise<Session> {
  // Inside the container Chromium renders onto the Xvfb display that noVNC
  // mirrors, so "headed" costs nothing and never opens a window on the host.
  const headless = env.display ? false : settings.headless;

  const dir = profileDir(options.profileKey);
  if (activeProfileDirs.has(dir)) {
    throw new Error(`Browser profile "${options.profileKey}" is already open`);
  }

  fs.mkdirSync(dir, { recursive: true });
  clearStaleLocks(dir);
  activeProfileDirs.add(dir);

  // Keyed per account so that, with the per-account strategy, one account keeps
  // the same exit address for the whole OAuth flow.
  const proxy = resolveProxy(settings, options.proxyKey ?? options.profileKey);

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(dir, {
      headless,
      args: launchArgs(),
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      ignoreHTTPSErrors: true,
      ...(proxy
        ? {
            proxy: {
              server: proxy.server,
              username: proxy.username,
              password: proxy.password,
            },
          }
        : {}),
    });
  } catch (err) {
    activeProfileDirs.delete(dir);
    throw err;
  }

  context.setDefaultNavigationTimeout(settings.navigationTimeoutMs);
  context.setDefaultTimeout(settings.actionTimeoutMs);

  let page: Page;
  try {
    page = context.pages()[0] ?? (await context.newPage());
  } catch (err) {
    await context.close().catch(() => undefined);
    activeProfileDirs.delete(dir);
    throw err;
  }
  let closed = false;

  return {
    context,
    page,
    proxy,
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await context.close().catch(() => undefined);
      } finally {
        activeProfileDirs.delete(dir);
      }
    },
  };
}

export async function captureScreenshot(page: Page, label: string): Promise<string | null> {
  try {
    fs.mkdirSync(paths.screenshots, { recursive: true });
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const filename = `${Date.now()}_${safeLabel}.png`;
    await page.screenshot({ path: path.join(paths.screenshots, filename), fullPage: false });
    return filename;
  } catch {
    return null;
  }
}

export function listScreenshots(): string[] {
  if (!fs.existsSync(paths.screenshots)) return [];
  return fs
    .readdirSync(paths.screenshots)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .reverse();
}

export function clearScreenshots(): number {
  const files = listScreenshots();
  for (const file of files) {
    fs.rmSync(path.join(paths.screenshots, file), { force: true });
  }
  return files.length;
}

/** Tries each candidate selector in order and returns the first visible match. */
export async function findFirstVisible(page: Page, candidates: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  do {
    for (const selector of candidates) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.isVisible({ timeout: 500 })) return locator;
      } catch {
        /* an invalid or not-yet-rendered selector just falls through */
      }
    }
    await page.waitForTimeout(300);
  } while (Date.now() < deadline);

  return null;
}

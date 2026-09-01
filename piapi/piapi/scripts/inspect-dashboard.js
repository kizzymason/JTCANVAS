/**
 * Reuses an already-authenticated per-account profile inside the container to
 * find where piapi.ai exposes the session cookie and the API key.
 *
 *   docker compose exec api node /tmp/inspect-dashboard.js account-1
 */
const { chromium } = require('/app/server/node_modules/playwright');

const profile = `/data/browser-profile/${process.argv[2] || 'account-1'}`;

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto('https://piapi.ai/workspace', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  console.log('url:', page.url());

  const cookies = await context.cookies();
  console.log('\n=== cookies by domain ===');
  for (const c of cookies) {
    console.log(`  ${c.domain.padEnd(22)} ${c.name.padEnd(28)} len=${String(c.value.length).padEnd(5)} httpOnly=${c.httpOnly}`);
  }

  console.log('\n=== is this page signed in? ===');
  for (const sel of [
    'button:has-text("Log in")',
    'button:has-text("Log out")',
    'button:has-text("Sign out")',
    '[data-testid="user-menu"]',
    'text=Create API key',
  ]) {
    const n = await page.locator(sel).count();
    const vis = n ? await page.locator(sel).first().isVisible().catch(() => false) : false;
    console.log(`  ${sel.padEnd(36)} count=${n} visible=${vis}`);
  }

  console.log('\n=== navigating to the API keys view ===');
  const apiKeysNav = page.locator('a:has-text("API Keys"), button:has-text("API Keys")').first();
  if (await apiKeysNav.count()) {
    await apiKeysNav.click().catch(() => undefined);
    await page.waitForTimeout(3500);
  }
  console.log('url:', page.url());

  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log('\n=== page text (first 1500 chars) ===');
  console.log(bodyText.slice(0, 1500));

  console.log('\n=== elements whose text/value looks like a key ===');
  const candidates = await page.evaluate(() => {
    const out = [];
    const walk = document.querySelectorAll('input, code, span, div, td, p');
    for (const el of walk) {
      const value = el.value || (el.children.length === 0 ? el.textContent : '') || '';
      const text = value.trim();
      if (/^[A-Za-z0-9_-]{20,}$/.test(text)) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          testid: el.getAttribute('data-testid') || '',
          sample: `${text.slice(0, 12)}…(${text.length})`,
        });
      }
    }
    return out.slice(0, 20);
  });
  for (const c of candidates) {
    console.log(`  ${c.tag.padEnd(6)} testid=${c.testid.padEnd(16)} class=${c.cls.padEnd(40)} ${c.sample}`);
  }

  await page.screenshot({ path: '/data/screenshots/inspect-dashboard.png', fullPage: true });
  console.log('\nscreenshot: /data/screenshots/inspect-dashboard.png');

  await context.close();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

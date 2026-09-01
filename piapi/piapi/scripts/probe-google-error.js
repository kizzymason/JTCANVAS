/**
 * Finds which element Google puts its inline sign-in error into, so the
 * registrar can quote the real complaint instead of guessing from body text.
 *
 *   docker compose exec api node /tmp/probe-google-error.js
 */
const { chromium } = require('/app/server/node_modules/playwright');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  '[aria-live="assertive"]',
  '[aria-live="polite"]',
  'div[jsname="B34EJ"]',
  'div.Ekjuhf',
  'div.o6cuMc',
  '[role="alert"]',
  'input#identifierId[aria-invalid="true"]',
];

(async () => {
  const context = await chromium.launchPersistentContext(`/tmp/gerr-${Date.now()}`, {
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto('https://piapi.ai/workspace?login=1', { waitUntil: 'networkidle', timeout: 60000 });
  await wait(2500);
  await page.locator('button:has-text("Continue with Google")').first().click();
  await wait(6000);

  await page.locator('input#identifierId').fill('piapi-probe-nonexistent-9182734@gmail.com');
  await page.locator('#identifierNext button, #identifierNext').first().click();
  await wait(5000);

  console.log(`url: ${page.url().slice(0, 90)}\n`);
  for (const sel of CANDIDATES) {
    const n = await page.locator(sel).count();
    let texts = [];
    for (let i = 0; i < Math.min(n, 4); i += 1) {
      const t = (await page.locator(sel).nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (t) texts.push(t.slice(0, 90));
    }
    console.log(`${sel.padEnd(42)} count=${n}  ${texts.join(' || ')}`);
  }

  console.log('\n--- every visible line on the page ---');
  const text = await page.locator('body').innerText().catch(() => '');
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((l, i) => console.log(`  ${i}: ${l.slice(0, 90)}`));

  await context.close();
})().catch((err) => {
  console.error('PROBE FAILED:', err.message);
  process.exit(1);
});

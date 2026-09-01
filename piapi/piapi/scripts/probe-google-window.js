/**
 * Reports whether PiAPI opens Google OAuth in the current tab or a popup.
 * No account credentials are entered.
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'server', 'node_modules', 'playwright'));

const API = process.env.API_BASE || 'http://localhost:3001/api';

function proxyFrom(raw) {
  const url = new URL(raw.replace(/\{session\}/g, 'windowprobe'));
  return {
    server: `${url.protocol}//${url.host}`,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

(async () => {
  const { settings } = await fetch(`${API}/settings`).then((r) => r.json());
  const entry = settings.proxyPool.enabled
    ? settings.proxyPool.entries.find((item) => item.enabled && item.url)
    : null;
  const browser = await chromium.launch({
    headless: true,
    ...(entry ? { proxy: proxyFrom(entry.url) } : {}),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('request', (request) => {
    if (/auth|callback|signin|google/i.test(request.url())) {
      const parsed = new URL(request.url());
      console.log(`request ${request.method()} ${parsed.hostname}${parsed.pathname}`);
    }
  });
  page.on('response', (response) => {
    if (/auth|callback|signin|google/i.test(response.url())) {
      const parsed = new URL(response.url());
      console.log(`response ${response.status()} ${parsed.hostname}${parsed.pathname}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (/auth|callback|signin|google/i.test(request.url())) {
      console.log(`failed ${new URL(request.url()).hostname}: ${request.failure()?.errorText}`);
    }
  });

  await page.goto(settings.piapiWorkspaceUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const button = page.getByRole('button', { name: /continue with google/i }).first();
  await button.waitFor({ state: 'visible', timeout: 30000 });
  console.log(`button enabled=${await button.isEnabled()} text=${JSON.stringify(await button.innerText())}`);

  const popupPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await button.click();
  const popup = await popupPromise;
  await page
    .waitForURL(/accounts\.google\.com/i, { timeout: 90000 })
    .catch(() => undefined);

  console.log(`popup=${Boolean(popup)} pages=${context.pages().length}`);
  for (const [index, candidate] of context.pages().entries()) {
    console.log(`page[${index}]=${new URL(candidate.url()).hostname || '(blank)'}`);
  }
  console.log(`url=${page.url()}`);

  await browser.close();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

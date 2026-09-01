/**
 * Looks for a bot-detection gate on the piapi.ai login dialog.
 *
 * PiAPI sits behind Cloudflare, while Google may also render reCAPTCHA or other
 * identity challenges. This reports whether either side added such a gate.
 *
 *   docker compose exec api node /tmp/probe-botcheck.js
 */
const { chromium } = require('/app/server/node_modules/playwright');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const WIDGETS = [
  '.cf-turnstile',
  '[data-sitekey]',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="recaptcha"]',
  'input[name="cf-turnstile-response"]',
  'input[name="g-recaptcha-response"]',
  'input[name="h-captcha-response"]',
];

const INTERESTING = /turnstile|hcaptcha|recaptcha|challenges\.cloudflare|fingerprint|botd|datadome|perimeterx|arkose/i;

(async () => {
  const context = await chromium.launchPersistentContext(`/tmp/bot-${Date.now()}`, {
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  const requests = [];
  page.on('request', (r) => {
    if (INTERESTING.test(r.url())) requests.push(`REQ  ${r.method()} ${r.url().slice(0, 120)}`);
  });
  page.on('response', (r) => {
    if (INTERESTING.test(r.url())) requests.push(`RES  ${r.status()} ${r.url().slice(0, 120)}`);
  });

  await page.goto('https://piapi.ai/workspace?login=1', { waitUntil: 'networkidle', timeout: 60000 });
  await wait(5000);

  console.log('--- bot-widget elements in the login dialog ---');
  let found = false;
  for (const sel of WIDGETS) {
    const n = await page.locator(sel).count();
    if (n) {
      found = true;
      console.log(`  ${sel.padEnd(46)} count=${n}`);
    }
  }
  if (!found) console.log('  none present');

  console.log('\n--- scripts loaded from bot-detection vendors ---');
  const scripts = await page.locator('script[src]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('src')).filter(Boolean),
  );
  const vendor = scripts.filter((s) => INTERESTING.test(s));
  console.log(vendor.length ? vendor.map((s) => `  ${s.slice(0, 120)}`).join('\n') : '  none');

  console.log('\n--- network traffic matching bot-detection vendors ---');
  console.log(requests.length ? requests.map((r) => `  ${r}`).join('\n') : '  none');

  console.log('\n--- cookies set on piapi.ai before login ---');
  for (const c of (await context.cookies()).filter((c) => c.domain.includes('piapi'))) {
    console.log(`  ${c.name.padEnd(34)} len=${c.value.length}`);
  }

  console.log('\n--- what the Google button actually triggers ---');
  const posts = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /piapi\.ai/.test(r.url())) {
      posts.push(`  POST ${r.url().slice(0, 110)}\n       body: ${(r.postData() || '').slice(0, 300)}`);
    }
  });
  await page.locator('button:has-text("Continue with Google")').first().click();
  await wait(4000);
  console.log(posts.length ? posts.join('\n') : '  no POST to piapi.ai captured');

  await context.close();
})().catch((err) => {
  console.error('PROBE FAILED:', err.message);
  process.exit(1);
});

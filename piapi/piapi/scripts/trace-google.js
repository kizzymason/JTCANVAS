/**
 * Walks the piapi.ai -> Google OAuth flow and dumps what each step actually
 * renders, so the selectors and the error strings in the registrar can be
 * matched against the real pages.
 *
 *   docker compose exec api node /tmp/trace-google.js <email> [password] [base32secret]
 */
const { chromium } = require('/app/server/node_modules/playwright');

const [email, password, secret] = process.argv.slice(2);
const SHOTS = '/data/screenshots';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const context = await chromium.launchPersistentContext(`/tmp/google-trace-${Date.now()}`, {
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) console.log(`  NAV -> ${f.url().slice(0, 140)}`);
  });

  const dump = async (name) => {
    await page.screenshot({ path: `${SHOTS}/gtrace-${name}.png` }).catch(() => {});
    const text = await page.locator('body').innerText().catch(() => '');
    console.log(`  [${name}] url=${page.url().slice(0, 110)}`);
    console.log(`  text: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
  };

  console.log('STEP 1: open piapi login dialog');
  await page.goto('https://piapi.ai/workspace?login=1', { waitUntil: 'networkidle', timeout: 60000 });
  await wait(2500);
  await dump('1-dialog');

  console.log('STEP 2: click Continue with Google');
  const btn = page.locator('button:has-text("Continue with Google")').first();
  console.log(`  button visible=${await btn.isVisible().catch(() => false)}`);
  await btn.click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await wait(5000);
  await dump('2-google');

  console.log('STEP 3: probe the email step selectors');
  for (const sel of ['input#identifierId', 'input[type="email"]', '#identifierNext button', '#identifierNext']) {
    const n = await page.locator(sel).count();
    const vis = n ? await page.locator(sel).first().isVisible().catch(() => false) : false;
    console.log(`  ${sel.padEnd(30)} count=${n} visible=${vis}`);
  }

  if (email) {
    console.log(`STEP 4: enter ${email}`);
    const field = page.locator('input#identifierId, input[type="email"]').first();
    if (await field.isVisible().catch(() => false)) {
      await field.fill(email);
      await page.locator('#identifierNext button, #identifierNext').first().click().catch(() => {});
      await wait(5000);
      await dump('3-after-email');
    } else {
      console.log('  email field not visible, skipping');
    }
  }

  if (password) {
    console.log('STEP 5: enter password');
    const field = page.locator('input[type="password"][name="Passwd"], input[type="password"]').first();
    if (await field.isVisible().catch(() => false)) {
      await field.fill(password);
      await page.locator('#passwordNext button, #passwordNext').first().click().catch(() => {});
      await wait(6000);
      await dump('4-after-password');
    } else {
      console.log('  password field not visible, skipping');
    }
  }

  if (secret) {
    const { authenticator } = require('/app/server/node_modules/otplib');
    const field = page.locator('input#totpPin, input[name="totpPin"]').first();
    if (await field.isVisible().catch(() => false)) {
      console.log('STEP 6: enter 2FA');
      await field.fill(authenticator.generate(secret.replace(/\s/g, '').toUpperCase()));
      await page.locator('#totpNext button, #totpNext').first().click().catch(() => {});
      await wait(6000);
      await dump('5-after-2fa');
    }
  }

  await wait(4000);
  await dump('6-final');
  console.log(`\nfinal url: ${page.url()}`);
  await context.close();
})().catch((err) => {
  console.error('TRACE FAILED:', err.message);
  process.exit(1);
});

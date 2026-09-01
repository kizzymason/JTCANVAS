/**
 * Probes the live piapi.ai login flow and reports the controls it finds, so the
 * default selector list in server/src/config.ts reflects the real markup.
 * No credentials are submitted.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'server', 'node_modules', 'playwright'));

const OUT = path.join(__dirname, '..', 'screenshots');

async function describe(page, label) {
  const controls = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('button, a[href], [role="button"]'));
    return nodes
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .slice(0, 60)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50),
        href: el.getAttribute('href') || '',
        testid: el.getAttribute('data-testid') || '',
      }))
      .filter((el) => el.text || el.href);
  });

  console.log(`\n===== ${label} =====`);
  console.log(`url: ${page.url()}`);
  for (const c of controls) {
    if (/log ?in|sign ?in|google|continue|auth/i.test(c.text + c.href)) {
      console.log(`  ${c.tag.padEnd(6)} text=${JSON.stringify(c.text).padEnd(34)} href=${c.href.slice(0, 70)} testid=${c.testid}`);
    }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('https://piapi.ai/workspace', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await describe(page, 'workspace landing');
  await page.screenshot({ path: path.join(OUT, 'discover-1-landing.png') });

  const loginButton = page
    .locator('button:has-text("Log in"), a:has-text("Log in"), button:has-text("Login")')
    .first();

  if (await loginButton.count()) {
    console.log('\n-> clicking "Log in"');
    await loginButton.click();
    await page.waitForTimeout(3000);
    await describe(page, 'after clicking Log in');
    await page.screenshot({ path: path.join(OUT, 'discover-2-login.png') });

    const googleLink = await page
      .locator('a[href*="google"], button:has-text("Google"), a:has-text("Google")')
      .first()
      .getAttribute('href')
      .catch(() => null);
    console.log(`\ngoogle control href: ${googleLink}`);
  } else {
    console.log('\n-> no "Log in" control found on the landing page');
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

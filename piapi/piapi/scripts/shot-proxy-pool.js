/**
 * Screenshots the proxy pool card on the settings page.
 *
 * The general UI smoke test only captures the viewport, so a card this far
 * down the page never appears in its output.
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'server', 'node_modules', 'playwright'));

const BASE = process.env.UI_BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'screenshots', 'proxy-pool.png');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  const card = page.locator('.ant-card', { hasText: '代理池' }).first();
  await card.waitFor({ state: 'visible', timeout: 20000 });
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const rows = await card.locator('.ant-table-tbody tr.ant-table-row').count();
  const toggled = await card.locator('.ant-card-head .ant-switch-checked').count();
  console.log(`proxy card: ${rows} row(s), master switch ${toggled ? 'on' : 'off'}`);

  // Clicking through proves the button is wired to the API, which a screenshot
  // of the resting state cannot show.
  await card.getByRole('button', { name: '测试全部' }).click();
  await card.locator('.ant-tag').first().waitFor({ state: 'visible', timeout: 180000 });
  await page.waitForTimeout(500);

  const outcomes = await card.locator('.ant-tag').allInnerTexts();
  console.log(`test-all results: ${outcomes.join(', ') || 'none'}`);

  await card.screenshot({ path: OUT });
  console.log(`written to ${OUT}`);

  await browser.close();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

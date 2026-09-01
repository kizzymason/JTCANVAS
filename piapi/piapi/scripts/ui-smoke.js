/**
 * Drives the running stack with a real browser and screenshots every page.
 * Any uncaught page error (the class of bug that used to white-screen
 * "注册控制") fails the run.
 *
 *   node scripts/ui-smoke.js [baseUrl]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'server', 'node_modules', 'playwright'));

const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'screenshots');

const PAGES = [
  { path: '/accounts', name: 'accounts', title: '账号管理' },
  { path: '/register', name: 'register', title: '注册控制' },
  { path: '/results', name: 'results', title: '完成列表' },
  { path: '/export', name: 'export', title: '数据导出' },
  { path: '/settings', name: 'settings', title: '系统设置' },
  { path: '/diagnostics', name: 'diagnostics', title: '接口诊断' },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
  });

  let failures = 0;

  for (const target of PAGES) {
    const before = errors.length;
    await page.goto(`${BASE}${target.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    const heading = await page.locator('header h2').first().textContent().catch(() => null);
    const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
    const blank = bodyText.trim().length < 40;
    const newErrors = errors.slice(before);

    await page.screenshot({ path: path.join(OUT, `${target.name}.png`), fullPage: false });

    const ok = heading === target.title && !blank && newErrors.length === 0;
    if (!ok) failures += 1;

    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${target.path.padEnd(14)} header=${JSON.stringify(heading)} chars=${bodyText.trim().length}` +
        (newErrors.length ? `\n      ${newErrors.join('\n      ')}` : ''),
    );
  }

  // The bulk import dialog is what used to do nothing at all.
  await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '批量导入' }).click();
  await page.waitForTimeout(500);
  const dialogVisible = await page.locator('.ant-modal-content').isVisible();

  await page
    .locator('.ant-modal-content textarea')
    .fill('smoketest_a----pw1----Q7IQCSI25QBJCQCZ\nbadline----only2\nsmoketest_b----pw2----RC6E3KD2DGPOUTWZ');
  await page.waitForTimeout(1400);
  const previewText = await page.locator('.ant-modal-content').innerText();
  await page.screenshot({ path: path.join(OUT, 'bulk-import-dialog.png') });

  const parsedOk = /有效账号/.test(previewText) && /无法解析/.test(previewText);
  if (!dialogVisible || !parsedOk) failures += 1;
  console.log(
    `${dialogVisible && parsedOk ? 'PASS' : 'FAIL'}  bulk import dialog visible=${dialogVisible} preview=${parsedOk}`,
  );

  await browser.close();

  console.log(`\nscreenshots written to ${OUT}`);
  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nall UI checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

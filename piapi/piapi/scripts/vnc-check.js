/**
 * Opens the noVNC modal and screenshots it, proving the container-side Chromium
 * is reachable from the UI (this is the per-account Google-assistance path).
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'server', 'node_modules', 'playwright'));

const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'screenshots');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const accountsResponse = await fetch(`${BASE}/api/accounts`);
  const { accounts } = await accountsResponse.json();
  if (!accountsResponse.ok || !accounts?.length) throw new Error('At least one account is required for this check');

  // Start the first account's real profile so the UI can open its noVNC view.
  const started = await fetch(`${BASE}/api/register/auth-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId: accounts[0].id }),
  });
  if (!started.ok) throw new Error(`Could not open the auth session: HTTP ${started.status}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  try {
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '打开 noVNC 视图' }).click();
    await page.waitForTimeout(6000);

    await page.screenshot({ path: path.join(OUT, 'novnc-modal.png') });

    const frame = page.frameLocator('iframe[title="noVNC"]');
    const canvasCount = await frame.locator('canvas').count().catch(() => 0);
    const statusText = await frame.locator('#noVNC_status').textContent().catch(() => null);

    console.log(`noVNC iframe canvas elements: ${canvasCount}`);
    console.log(`noVNC status text: ${JSON.stringify(statusText)}`);
    console.log(`screenshot: ${path.join(OUT, 'novnc-modal.png')}`);

    process.exitCode = canvasCount > 0 ? 0 : 1;
  } finally {
    await browser.close();
    // Leaving it open would block the queue and the egress check.
    await fetch(`${BASE}/api/register/auth-session`, { method: 'DELETE' }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

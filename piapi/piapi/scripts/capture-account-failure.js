/**
 * Copies the latest server-side failure screenshot into the local screenshots
 * folder through the public API, where Cursor can inspect it.
 *
 *   node scripts/capture-account-failure.js <account-id>
 */
const fs = require('fs');
const path = require('path');

const id = Number(process.argv[2]);
if (!Number.isInteger(id)) throw new Error('Usage: node scripts/capture-account-failure.js <account-id>');

(async () => {
  const account = await fetch(`http://localhost:3001/api/accounts/${id}`).then((r) => r.json());
  if (!account.screenshotPath) throw new Error(`Account ${id} has no failure screenshot`);

  const response = await fetch(
    `http://localhost:3001/api/screenshots/${encodeURIComponent(account.screenshotPath)}`,
  );
  if (!response.ok) throw new Error(`Screenshot request failed: HTTP ${response.status}`);

  const out = path.join(__dirname, '..', 'screenshots', `account-${id}-failure.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await response.arrayBuffer()));
  console.log(out);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

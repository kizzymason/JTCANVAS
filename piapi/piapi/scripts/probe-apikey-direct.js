/**
 * Verifies PiAPI key extraction without touching the dashboard DOM.
 *
 *   docker compose exec api node /tmp/probe-apikey-direct.js account-13
 */
const { constants, generateKeyPairSync, privateDecrypt } = require('crypto');
const { chromium } = require('/app/server/node_modules/playwright');

const profile = `/data/browser-profile/${process.argv[2] || 'account-13'}`;

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const listResponse = await context.request.get('https://piapi.ai/api/v2/api-keys/all');
  const list = await listResponse.json();
  if (!listResponse.ok() || !list.success) throw new Error(`list failed: ${JSON.stringify(list)}`);

  let keyRecord = list.data[0];
  if (!keyRecord) {
    const addResponse = await context.request.post('https://piapi.ai/api/v2/api-keys/add', {
      data: { name: 'PiAPI-Auto' },
    });
    const added = await addResponse.json();
    if (!addResponse.ok() || !added.success) throw new Error(`add failed: ${JSON.stringify(added)}`);
    keyRecord = added.data;
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const revealResponse = await context.request.post('https://piapi.ai/api/v2/api-keys/reveal', {
    data: {
      id: keyRecord.id,
      publicKey: {
        alg: 'RSA-OAEP-256',
        e: jwk.e,
        ext: true,
        key_ops: ['encrypt'],
        kty: jwk.kty,
        n: jwk.n,
      },
    },
  });
  const revealed = await revealResponse.json();
  if (!revealResponse.ok() || !revealed.success) {
    throw new Error(`reveal failed: ${JSON.stringify(revealed)}`);
  }

  const apiKey = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(revealed.data.ciphertext, 'base64'),
  ).toString('utf8');

  console.log(
    JSON.stringify({
      id: keyRecord.id,
      name: keyRecord.name,
      masked: `${apiKey.slice(0, 8)}••••${apiKey.slice(-4)}`,
      length: apiKey.length,
    }),
  );
  await context.close();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

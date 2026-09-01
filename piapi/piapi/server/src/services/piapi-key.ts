import {
  constants,
  generateKeyPairSync,
  privateDecrypt,
  type JsonWebKey,
  type KeyObject,
} from 'crypto';
import type { APIResponse, BrowserContext } from 'playwright';
import type { Account, AppSettings } from '../types';
import { openSession } from './browser';

interface PiApiKeyRecord {
  id: number;
  name: string;
  masked_value: string;
  created_at: string;
}

interface PiApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface RevealPayload {
  id: number;
  ciphertext: string;
  alg?: string;
}

export interface PiApiKeyResult {
  apiKey: string;
  keyId: number;
  keyName: string;
  created: boolean;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function responseJson<T>(
  response: APIResponse,
  operation: string,
): Promise<PiApiResponse<T>> {
  let payload: PiApiResponse<T>;
  try {
    payload = (await response.json()) as PiApiResponse<T>;
  } catch {
    throw new Error(`PiAPI ${operation} returned ${response.status()} instead of JSON`);
  }

  if (!response.ok() || payload.success !== true || payload.data === undefined) {
    const detail = payload.error || payload.message || `${response.status()} ${response.statusText()}`;
    throw new Error(`PiAPI ${operation} failed: ${detail}`);
  }
  return payload;
}

function publicEncryptionJwk(publicKey: JsonWebKey): JsonWebKey {
  if (!publicKey.n || !publicKey.e || !publicKey.kty) {
    throw new Error('Failed to export the RSA public key');
  }
  return {
    alg: 'RSA-OAEP-256',
    e: publicKey.e,
    ext: true,
    key_ops: ['encrypt'],
    kty: publicKey.kty,
    n: publicKey.n,
  };
}

function decryptApiKey(ciphertext: string, privateKey: KeyObject): string {
  const value = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(ciphertext, 'base64'),
  ).toString('utf8');

  if (!/^[A-Za-z0-9_-]{24,}$/.test(value)) {
    throw new Error('PiAPI returned an invalid decrypted API key');
  }
  return value;
}

/**
 * PiAPI encrypts revealed keys with an ephemeral RSA public key supplied by
 * the caller. Reproducing that protocol is faster and more stable than
 * clicking dashboard controls, while still using the account's browser session.
 */
export async function ensurePiApiKey(
  context: BrowserContext,
  baseUrl: string,
): Promise<PiApiKeyResult> {
  const listResponse = await context.request.get(endpoint(baseUrl, '/api/v2/api-keys/all'));
  const list = await responseJson<PiApiKeyRecord[]>(listResponse, 'API key list');

  let record = list.data?.find((key) => key.name === 'PiAPI-Auto') ?? list.data?.[0];
  let created = false;

  if (!record) {
    const addResponse = await context.request.post(endpoint(baseUrl, '/api/v2/api-keys/add'), {
      data: { name: 'PiAPI-Auto' },
    });
    const added = await responseJson<PiApiKeyRecord>(addResponse, 'API key creation');
    record = added.data;
    created = true;
  }

  if (!record || !Number.isInteger(record.id)) {
    throw new Error('PiAPI returned an invalid API key record');
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const revealResponse = await context.request.post(endpoint(baseUrl, '/api/v2/api-keys/reveal'), {
    data: {
      id: record.id,
      publicKey: publicEncryptionJwk(publicKey.export({ format: 'jwk' })),
    },
  });
  const revealed = await responseJson<RevealPayload>(revealResponse, 'API key reveal');

  if (!revealed.data?.ciphertext) {
    throw new Error('PiAPI reveal response did not contain ciphertext');
  }

  return {
    apiKey: decryptApiKey(revealed.data.ciphertext, privateKey),
    keyId: record.id,
    keyName: record.name,
    created,
  };
}

/** Opens the account's persistent profile and refreshes its PiAPI key. */
export async function syncAccountPiApiKey(
  account: Account,
  settings: AppSettings,
): Promise<PiApiKeyResult> {
  const session = await openSession(settings, {
    profileKey: `account-${account.id}`,
    proxyKey: `account-${account.id}`,
  });
  try {
    return await ensurePiApiKey(session.context, settings.piapiBaseUrl);
  } finally {
    await session.close();
  }
}

import { authenticator } from 'otplib';

const BASE32_ALPHABET = /^[A-Z2-7]+=*$/;

/** Users paste secrets with spaces, lowercase letters and `otpauth://` prefixes. */
export function normalizeSecret(raw: string): string {
  let value = (raw ?? '').trim();

  if (value.toLowerCase().startsWith('otpauth://')) {
    try {
      const url = new URL(value);
      value = url.searchParams.get('secret') ?? '';
    } catch {
      /* fall through and treat the input as a plain secret */
    }
  }

  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidSecret(raw: string): boolean {
  const secret = normalizeSecret(raw);
  // Google Authenticator-compatible secrets use RFC 4648 base32.
  return secret.length >= 8 && BASE32_ALPHABET.test(secret);
}

/**
 * Google TOTP secrets are base32. `authenticator` decodes base32, while otplib's
 * `totp` helper treats the secret as raw bytes and silently returns wrong codes.
 */
export function generateCode(raw: string): string {
  const secret = normalizeSecret(raw);
  if (!isValidSecret(secret)) {
    throw new Error('Invalid TOTP secret: expected base32 (A-Z, 2-7)');
  }
  return authenticator.generate(secret);
}

export function secondsRemaining(): number {
  return authenticator.timeRemaining();
}

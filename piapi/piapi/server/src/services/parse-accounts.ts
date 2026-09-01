import { isValidSecret, normalizeSecret } from './totp';
import type { NewAccount } from '../db/accounts';

export interface ParsedLine {
  line: number;
  raw: string;
  account?: NewAccount;
  error?: string;
}

export interface ParseReport {
  accounts: NewAccount[];
  errors: ParsedLine[];
  total: number;
}

/**
 * Ordered by specificity: `----` must be tried before `-` never appears as a
 * separator on its own, and multi-char delimiters must beat single characters.
 */
const DELIMITERS = ['----', '|', '\t', ';', ',', '   '];

function splitLine(line: string): string[] {
  for (const delimiter of DELIMITERS) {
    if (line.includes(delimiter)) {
      // Preserve an empty third field in username|password||recovery@email:
      // dropping it would shift recoveryEmail into the TOTP slot.
      return line.split(delimiter).map((part) => part.trim());
    }
  }
  return line.split(/\s+/).map((part) => part.trim());
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseAccountLines(text: string): ParseReport {
  const accounts: NewAccount[] = [];
  const errors: ParsedLine[] = [];
  const seen = new Set<string>();

  const lines = (text ?? '').split(/\r?\n/);
  let total = 0;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;

    total += 1;
    const parts = splitLine(line);

    if (parts.length < 3) {
      errors.push({
        line: index + 1,
        raw: line,
        error: `Expected Google email, password and TOTP/recovery email, found ${parts.length} fields`,
      });
      return;
    }
    if (parts.length > 4) {
      errors.push({
        line: index + 1,
        raw: line,
        error: `Expected at most 4 fields, found ${parts.length}`,
      });
      return;
    }

    const [username, password, third = '', fourth = ''] = parts;
    // Three-field Google lists commonly put the recovery address in the old
    // TOTP position. Four fields are unambiguous: TOTP then recovery email.
    const thirdIsRecovery = parts.length === 3 && looksLikeEmail(third);
    const recoveryRaw = thirdIsRecovery ? third : fourth;
    const secretRaw = thirdIsRecovery ? '' : third;

    if (!looksLikeEmail(username)) {
      errors.push({ line: index + 1, raw: line, error: 'Google account must be a complete email address' });
      return;
    }
    if (!password) {
      errors.push({ line: index + 1, raw: line, error: 'Password is empty' });
      return;
    }
    if (!secretRaw && !recoveryRaw) {
      errors.push({
        line: index + 1,
        raw: line,
        error: 'Either a base32 TOTP secret or a recovery email is required',
      });
      return;
    }
    if (secretRaw && !isValidSecret(secretRaw)) {
      errors.push({
        line: index + 1,
        raw: line,
        error: `"${secretRaw}" is not a valid base32 TOTP secret`,
      });
      return;
    }
    if (recoveryRaw && !looksLikeEmail(recoveryRaw)) {
      errors.push({
        line: index + 1,
        raw: line,
        error: `"${recoveryRaw}" is not a valid recovery email`,
      });
      return;
    }

    const key = username.toLowerCase();
    if (seen.has(key)) {
      errors.push({ line: index + 1, raw: line, error: `Duplicate Google account "${username}" in this batch` });
      return;
    }
    seen.add(key);

    accounts.push({
      username,
      password,
      totpSecret: secretRaw ? normalizeSecret(secretRaw) : '',
      recoveryEmail: recoveryRaw.toLowerCase(),
    });
  });

  return { accounts, errors, total };
}

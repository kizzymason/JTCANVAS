export type AccountStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Account {
  id: number;
  username: string;
  password: string;
  totpSecret: string;
  /** Google recovery address used by the "Confirm your recovery email" challenge. */
  recoveryEmail: string;
  status: AccountStatus;
  apiKey: string | null;
  cookieToken: string | null;
  attempts: number;
  lastError: string | null;
  screenshotPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Account with the password removed, safe to send to the browser. */
export type SafeAccount = Omit<Account, 'password'> & { password?: string };

export interface RegistrationLog {
  id: number;
  accountId: number | null;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  createdAt: string;
}

export interface ProxyEntry {
  id: string;
  label: string;
  /**
   * `http://user:pass@host:port` or `socks5://host:port`.
   *
   * A `{session}` placeholder anywhere in the string is replaced with a token
   * derived from the account being processed. Rotating residential gateways
   * need this: without a sticky session they hand out a different exit per
   * request, and an OAuth flow whose IP changes halfway through looks like
   * account theft to Google.
   */
  url: string;
  enabled: boolean;
}

/**
 * - `per-account` keeps one account on one entry for the whole run, which is
 *   what you want when each entry is a distinct identity.
 * - `round-robin` spreads load evenly across entries.
 * - `random` picks independently every time.
 */
export type ProxyStrategy = 'per-account' | 'round-robin' | 'random';

export interface ProxyPool {
  enabled: boolean;
  strategy: ProxyStrategy;
  entries: ProxyEntry[];
}

export interface ProxyTestResult {
  id: string;
  label: string;
  ok: boolean;
  ip: string | null;
  org: string | null;
  country: string | null;
  latencyMs: number;
  error: string | null;
}

export interface SelectorSet {
  piapiLoginTrigger: string[];
  piapiGoogleSignInButton: string[];
  googleEmailField: string[];
  googleEmailNextButton: string[];
  googlePasswordField: string[];
  googlePasswordNextButton: string[];
  googleOtpField: string[];
  googleOtpSubmitButton: string[];
  googleWelcomeButton: string[];
  googleRecoveryChoice: string[];
  googleRecoveryEmailField: string[];
  googleRecoverySubmitButton: string[];
  googleConsentButton: string[];
  googleErrorText: string[];
  piapiLoggedInMarker: string[];
}

export interface AppSettings {
  maxConcurrent: number;
  maxRetries: number;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  headless: boolean;
  dryRun: boolean;
  proxyPool: ProxyPool;
  piapiBaseUrl: string;
  piapiWorkspaceUrl: string;
  cookieTokenNames: string[];
  selectors: SelectorSet;
}

export interface QueueProgress {
  running: boolean;
  total: number;
  processed: number;
  success: number;
  failed: number;
  active: string[];
}

export type ServerEvent =
  | { type: 'progress'; payload: QueueProgress }
  | { type: 'log'; payload: { accountId: number | null; username?: string; level: RegistrationLog['level']; message: string; at: string } }
  | { type: 'account'; payload: SafeAccount }
  | { type: 'queue-finished'; payload: QueueProgress }
  | { type: 'auth-session'; payload: { active: boolean; accountId: number | null; message: string } };

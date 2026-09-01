import path from 'path';
import type { AppSettings } from './types';

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../data');

export const paths = {
  dataDir: DATA_DIR,
  dbFile: path.join(DATA_DIR, 'piapi.db'),
  browserProfile: path.join(DATA_DIR, 'browser-profile'),
  screenshots: path.join(DATA_DIR, 'screenshots'),
};

export const env = {
  port: Number(process.env.PORT ?? 3001),
  /** Set by the container so Playwright renders onto the Xvfb display exposed over noVNC. */
  display: process.env.DISPLAY ?? '',
  novncUrl: process.env.NOVNC_URL ?? '/vnc/',
  inContainer: process.env.IN_CONTAINER === '1',
};

/**
 * Selectors are stored as ordered candidate lists: the registrar tries each in turn.
 * Google and piapi.ai both change markup without notice, so these are overridable at
 * runtime from the settings page rather than baked into the image.
 */
export const defaultSettings: AppSettings = {
  maxConcurrent: 2,
  maxRetries: 2,
  navigationTimeoutMs: 45000,
  actionTimeoutMs: 15000,
  headless: false,
  dryRun: false,
  // Credentials belong in the database (a gitignored volume), never here.
  proxyPool: { enabled: false, strategy: 'per-account', entries: [] },
  piapiBaseUrl: 'https://piapi.ai',
  // `?login=1` opens the sign-in dialog straight away, skipping a click.
  piapiWorkspaceUrl: 'https://piapi.ai/workspace?login=1',
  // piapi.ai runs NextAuth; the session cookie is `__Secure-next-auth.session-token`
  // in production and `next-auth.session-token` over plain HTTP.
  cookieTokenNames: [
    'next-auth.session-token',
    'session-token',
    'sb-access-token',
    'session',
    'token',
  ],
  selectors: {
    // Opens the login dialog when the URL alone did not.
    piapiLoginTrigger: [
      'button:has-text("Log in")',
      'a:has-text("Log in")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
    ],
    piapiGoogleSignInButton: [
      'button:has-text("Continue with Google")',
      'a:has-text("Continue with Google")',
      'button:has-text("Sign in with Google")',
      'a:has-text("Sign in with Google")',
      'button:has-text("Google")',
    ],
    // Google splits the form across animated pages: email, then password, then
    // 2FA. Each step needs its own "Next", and the buttons carry no stable
    // text, so the wrapper ids are the reliable anchors.
    // The address box is type="text", not type="email" — #identifierId is the
    // only dependable anchor.
    googleEmailField: ['input#identifierId', 'input[name="identifier"]', 'input[type="email"]'],
    googleEmailNextButton: [
      '#identifierNext button',
      '#identifierNext',
      'button:has-text("Next")',
      'button:has-text("下一步")',
    ],
    googlePasswordField: ['input[type="password"][name="Passwd"]', 'input[type="password"]'],
    googlePasswordNextButton: [
      '#passwordNext button',
      '#passwordNext',
      'button:has-text("Next")',
      'button:has-text("下一步")',
    ],
    googleOtpField: [
      'input#totpPin',
      'input[name="totpPin"]',
      'input[type="tel"][autocomplete="one-time-code"]',
      'input[autocomplete="one-time-code"]',
    ],
    googleOtpSubmitButton: [
      '#totpNext button',
      '#totpNext',
      'button:has-text("Next")',
      'button:has-text("下一步")',
    ],
    googleWelcomeButton: [
      'button:has-text("I understand")',
      'button:has-text("Accept")',
      'button:has-text("我明白了")',
      'button:has-text("接受")',
    ],
    // Google may first show a method picker, then /challenge/kpe asks the user
    // to type the complete recovery address already attached to the account.
    googleRecoveryChoice: [
      '[data-challengetype="12"]',
      'text=/Confirm your recovery email/i',
      'text=/确认.*辅助邮箱/i',
      'text=/Recovery email/i',
    ],
    googleRecoveryEmailField: [
      'input[name="knowledgePreregisteredEmailResponse"]',
      'input#knowledge-preregistered-email-response',
    ],
    googleRecoverySubmitButton: [
      '#knowledge-preregistered-email-next button',
      '#next button',
      'button:has-text("Next")',
      'button:has-text("下一步")',
    ],
    googleConsentButton: [
      '#submit_approve_access',
      '[data-is-consent="true"] button',
      'form[action*="oauth"] button:has-text("Continue")',
      'button:has-text("Continue")',
      'button:has-text("Allow")',
      'button:has-text("Confirm")',
      'button:has-text("继续")',
      'button:has-text("允许")',
      'button:has-text("确认")',
    ],
    // Where Google puts the inline complaint ("Couldn't find this account",
    // "Wrong password"). Read instead of matching text: the messages are
    // localised and use a typographic apostrophe.
    googleErrorText: ['div[jsname="B34EJ"]', 'div.Ekjuhf', '[aria-live="assertive"]'],
    // Must not match anything a signed-out visitor sees; the dashboard shows
    // "API Keys" and "Create API key" to guests, so those make poor markers.
    piapiLoggedInMarker: [
      '[data-testid="user-menu"]',
      'button:has-text("Log out")',
      'button:has-text("Sign out")',
      'text=Sign out',
    ],
  },
};

import type { Page } from 'playwright';
import { openSession, findFirstVisible, captureScreenshot } from './browser';
import { generateCode } from './totp';
import { condenseError } from './errors';
import { ensurePiApiKey } from './piapi-key';
import type { Account, AppSettings, RegistrationLog } from '../types';

export interface RegistrationOutcome {
  success: boolean;
  apiKey: string | null;
  cookieToken: string | null;
  message: string;
  screenshot: string | null;
  /** False when retrying cannot possibly help (bad credentials, site refusal). */
  retryable?: boolean;
}

export type LogSink = (level: RegistrationLog['level'], message: string) => void;

/** Cookies a signed-out visitor already has; never treat these as a session. */
const NON_SESSION_COOKIE = /csrf|state|callback-url|locale|^_ga|^_gid|publishedproject|pkce|nonce/i;

function baseDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'piapi.ai';
  }
}

/** Only PiAPI-domain cookies may count as a successful PiAPI session. */
async function extractCookieToken(
  context: Awaited<ReturnType<typeof openSession>>['context'],
  settings: AppSettings,
): Promise<string | null> {
  const domain = baseDomain(settings.piapiBaseUrl);
  const cookies = (await context.cookies()).filter((c) => c.domain.replace(/^\./, '').endsWith(domain));

  for (const name of settings.cookieTokenNames) {
    const needle = name.toLowerCase();
    const hit = cookies.find((c) => {
      const cookieName = c.name.toLowerCase();
      // csrf-token / next-auth.state / callback-url all exist before login and
      // matching them made a failed OAuth callback look like a success.
      if (NON_SESSION_COOKIE.test(cookieName)) return false;
      return cookieName.includes(needle) && c.value.length > 16;
    });
    if (hit) return hit.value;
  }
  return null;
}

async function dismissCookieBanner(page: Page): Promise<void> {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
  ];
  for (const selector of candidates) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 400 })) {
        await locator.click({ timeout: 2000 });
        return;
      }
    } catch {
      /* no banner on this page */
    }
  }
}

async function runDryRun(account: Account, log: LogSink): Promise<RegistrationOutcome> {
  log('info', 'DRY-RUN enabled: simulating the OAuth flow without touching any live site');
  if (account.totpSecret) {
    generateCode(account.totpSecret);
    log('info', 'TOTP secret is valid and a code was generated locally');
  } else {
    log('info', 'Recovery-email challenge is configured; no TOTP secret supplied');
  }
  await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 900));
  log('success', 'DRY-RUN finished');
  return {
    success: true,
    apiKey: `dryrun-${account.username}-${Date.now().toString(36)}`,
    cookieToken: `dryrun-cookie-${account.id}`,
    message: 'Dry run completed (no live request was made)',
    screenshot: null,
  };
}

interface FlowContext {
  page: Page;
  account: Account;
  settings: AppSettings;
  log: LogSink;
  /** Screenshots, logs and returns a failure outcome. */
  fail: (message: string, retryable?: boolean) => Promise<RegistrationOutcome>;
}

/** Resolves to a failure outcome, or null when the provider step went fine. */
type FlowStep = (ctx: FlowContext) => Promise<RegistrationOutcome | null>;

/** Fixed furniture present on every Google sign-in page. */
const GOOGLE_PAGE_FURNITURE =
  /^(Loading|Sign in( with Google)?|to continue to .*|Email or phone|Enter your password|Forgot email\?|Forgot password\?|Next|Create account|Show password|English.*|Help|Privacy|Terms)$/i;

/**
 * Reads Google's inline complaint. The messages are localised and use a
 * typographic apostrophe, so they are read out of the error element rather
 * than matched as English text.
 */
async function googleComplaint(page: Page, settings: AppSettings): Promise<string> {
  for (const selector of settings.selectors.googleErrorText) {
    const text = await page
      .locator(selector)
      .first()
      .innerText()
      .catch(() => '');
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed) return trimmed.slice(0, 160);
  }

  // Fall back to whatever line is left once the furniture is removed.
  const body = await page.locator('body').innerText().catch(() => '');
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.length < 120 && !GOOGLE_PAGE_FURNITURE.test(l))
    .find((l) => /[a-z]/i.test(l));
  return line ?? 'no message on the page';
}

type GoogleStepResult =
  | { handled: false }
  | { handled: true; error: null }
  | { handled: true; error: string };

/** Accepts the mandatory first-login notice shown by managed Workspace accounts. */
async function handleGoogleWelcome(
  page: Page,
  settings: AppSettings,
  log: LogSink,
): Promise<GoogleStepResult> {
  const body = await page.locator('body').innerText().catch(() => '');
  if (!/Welcome to your new account|欢迎使用您的新账号|欢迎使用新账号|歡迎使用您的新帳戶/i.test(body)) {
    return { handled: false };
  }

  log('info', 'Accepting the Google Workspace first-login notice');
  await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => undefined);
  await page.waitForTimeout(800);

  const button = await findFirstVisible(page, settings.selectors.googleWelcomeButton, 6000);
  if (!button) {
    return {
      handled: true,
      error: 'Google showed the Workspace first-login notice, but its confirmation button was not found',
    };
  }

  await button.click();
  await button.waitFor({ state: 'hidden', timeout: settings.navigationTimeoutMs }).catch(() => undefined);
  return { handled: true, error: null };
}

/**
 * Handles both Google variants:
 * 1. a method picker containing "Confirm your recovery email";
 * 2. a direct /challenge/kpe page with the address field already visible.
 */
async function handleGoogleRecoveryChallenge(
  page: Page,
  account: Account,
  settings: AppSettings,
  log: LogSink,
): Promise<GoogleStepResult> {
  if (!account.recoveryEmail) return { handled: false };

  let field = await findFirstVisible(page, settings.selectors.googleRecoveryEmailField, 1200);
  if (!field) {
    const choice = await findFirstVisible(page, settings.selectors.googleRecoveryChoice, 2500);
    if (!choice) return { handled: false };

    log('info', 'Selecting "Confirm your recovery email"');
    await choice.click().catch(() => undefined);
    await page.waitForTimeout(1800);
    field = await findFirstVisible(page, settings.selectors.googleRecoveryEmailField, 8000);
  }

  if (!field) {
    return {
      handled: true,
      error: 'Google showed the recovery-email method but its input field was not found',
    };
  }

  log('info', 'Confirming the configured Google recovery email');
  await field.fill(account.recoveryEmail);
  const submit = await findFirstVisible(
    page,
    settings.selectors.googleRecoverySubmitButton,
    settings.actionTimeoutMs,
  );
  if (!submit) {
    return { handled: true, error: 'Google recovery-email submit button was not found' };
  }

  await submit.click();
  await field.waitFor({ state: 'hidden', timeout: settings.navigationTimeoutMs }).catch(() => undefined);

  if (await findFirstVisible(page, settings.selectors.googleRecoveryEmailField, 1500)) {
    return {
      handled: true,
      error: `Google rejected the recovery email: ${await googleComplaint(page, settings)}`,
    };
  }

  return { handled: true, error: null };
}

const signInWithGoogle: FlowStep = async ({ page, account, settings, log, fail }) => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.username)) {
    return fail('Google account must be a complete email address', false);
  }

  let emailSubmitted = false;
  const emailField = await findFirstVisible(page, settings.selectors.googleEmailField, 12000);
  if (!emailField) {
    if (!/accounts\.google\.com/i.test(page.url())) return null;

    // A retry can land on Google's account chooser because this per-account
    // profile already remembers the identity from the previous attempt.
    const rememberedAccount = page
      .locator('[data-identifier]')
      .filter({ hasText: account.username })
      .first();
    if (await rememberedAccount.isVisible({ timeout: 1500 }).catch(() => false)) {
      log('info', 'Selecting the remembered Google account from the account chooser');
      await rememberedAccount.click();
      await page.waitForTimeout(3000);
    } else {
      log('info', 'Google identifier step was skipped by this account profile');
    }
  } else {
    log('info', 'Filling the Google account address');
    await emailField.fill(account.username);

    const emailNext = await findFirstVisible(
      page,
      settings.selectors.googleEmailNextButton,
      settings.actionTimeoutMs,
    );
    if (!emailNext) return fail('Google "Next" button after the email field not found');
    await emailNext.click();
    emailSubmitted = true;
  }

  // A fresh identifier submission must lead to the password step. A remembered
  // account may already be authenticated and jump directly to consent.
  const passwordField = await findFirstVisible(page, settings.selectors.googlePasswordField, 12000);
  if (!passwordField && emailSubmitted) {
    return fail(`Google did not accept the account address: ${await googleComplaint(page, settings)}`, false);
  }

  if (passwordField) {
    const identityNode = page.locator('#profileIdentifier, [data-email]').first();
    const presentedIdentity =
      (await identityNode.getAttribute('data-email').catch(() => null)) ??
      (await identityNode.innerText().catch(() => ''));
    const presentedEmail = presentedIdentity.match(/[^\s<>()]+@[^\s<>()]+/)?.[0]?.toLowerCase();
    if (presentedEmail && presentedEmail !== account.username.toLowerCase()) {
      return fail(
        `Google selected ${presentedEmail} instead of the configured account ${account.username}`,
        false,
      );
    }

    log('info', 'Filling the Google password');
    await passwordField.fill(account.password);

    const passwordNext = await findFirstVisible(
      page,
      settings.selectors.googlePasswordNextButton,
      settings.actionTimeoutMs,
    );
    if (!passwordNext) return fail('Google "Next" button after the password field not found');
    await passwordNext.click();
    await passwordField
      .waitFor({ state: 'hidden', timeout: settings.navigationTimeoutMs })
      .catch(() => undefined);

    // Still sitting on the password step means the password was refused.
    const passwordStuck = await findFirstVisible(page, settings.selectors.googlePasswordField, 2500);
    if (passwordStuck) {
      return fail(`Google rejected the password: ${await googleComplaint(page, settings)}`, false);
    }
  }

  // Google can order recovery-email, TOTP and consent screens differently per
  // account. Process what is actually visible instead of assuming one order.
  for (let round = 0; round < 8 && /accounts\.google\.com/i.test(page.url()); round += 1) {
    const welcome = await handleGoogleWelcome(page, settings, log);
    if (welcome.handled) {
      if (welcome.error) return fail(welcome.error, false);
      continue;
    }

    const recovery = await handleGoogleRecoveryChallenge(page, account, settings, log);
    if (recovery.handled) {
      if (recovery.error) return fail(recovery.error, false);
      continue;
    }

    const otpField = await findFirstVisible(page, settings.selectors.googleOtpField, 2500);
    if (otpField) {
      if (!account.totpSecret) {
        return fail('Google requested a TOTP code, but this account only has a recovery email configured', false);
      }

      const code = generateCode(account.totpSecret);
      log('info', 'Submitting the Google 2FA code');
      await otpField.fill(code);

      const otpSubmit = await findFirstVisible(page, settings.selectors.googleOtpSubmitButton, 4000);
      if (otpSubmit) await otpSubmit.click().catch(() => undefined);
      await otpField.waitFor({ state: 'hidden', timeout: settings.navigationTimeoutMs }).catch(() => undefined);

      if (await findFirstVisible(page, settings.selectors.googleOtpField, 1500)) {
        return fail(`Google rejected the 2FA code: ${await googleComplaint(page, settings)}`, false);
      }
      continue;
    }

    // Third-party consent only appears the first time this account authorizes piapi.
    const onConsentPage = /\/signin\/oauth|\/o\/oauth2/i.test(page.url());
    const consent = onConsentPage
      ? await findFirstVisible(page, settings.selectors.googleConsentButton, 2500)
      : null;
    if (consent) {
      log('info', 'Approving the Google consent screen');
      await consent.click().catch(() => undefined);
      await consent.waitFor({ state: 'hidden', timeout: settings.navigationTimeoutMs }).catch(() => undefined);
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      continue;
    }

    break;
  }

  // Anything still on accounts.google.com at this point is an identity
  // challenge (device prompt, recovery address, "browser may not be secure").
  if (/accounts\.google\.com/i.test(page.url())) {
    return fail(
      `Google stopped the sign-in with an additional challenge: ${await googleComplaint(page, settings)}. ` +
        'Open this account profile in the registration page noVNC assistant, finish the challenge once, then retry.',
    );
  }

  return null;
};

export async function registerAccount(
  account: Account,
  settings: AppSettings,
  log: LogSink,
  signal: { aborted: boolean },
): Promise<RegistrationOutcome> {
  if (settings.dryRun) {
    return runDryRun(account, log);
  }

  let session: Awaited<ReturnType<typeof openSession>>;
  try {
    session = await openSession(settings, {
      profileKey: `account-${account.id}`,
    });
  } catch (err) {
    const message = `Failed to launch the browser: ${condenseError(err)}`;
    log('error', message);
    return { success: false, apiKey: null, cookieToken: null, message, screenshot: null };
  }

  const { context } = session;
  const primaryPage = session.page;
  let page = primaryPage;
  let oauthPopup: Page | null = null;
  let screenshot: string | null = null;

  // Worth a log line: a rejection that only hits one pool entry is impossible
  // to spot afterwards without knowing which exit each run took.
  log(
    'info',
    session.proxy
      ? `Routing through proxy "${session.proxy.label}" (${session.proxy.server})`
      : 'Connecting directly, no proxy',
  );

  const fail = async (message: string, retryable = true): Promise<RegistrationOutcome> => {
    screenshot = await captureScreenshot(page, `${account.username}_fail`);
    log('error', message);
    return { success: false, apiKey: null, cookieToken: null, message, screenshot, retryable };
  };

  try {
    log('info', `Opening ${settings.piapiWorkspaceUrl}`);
    await page.goto(settings.piapiWorkspaceUrl, { waitUntil: 'domcontentloaded' });
    await dismissCookieBanner(page);

    if (signal.aborted) return await fail('Cancelled before sign-in');

    // piapi.ai renders the provider buttons inside a dialog. The `?login=1` URL
    // usually opens it; if not, the "Log in" control has to be clicked first.
    let signInButton = await findFirstVisible(page, settings.selectors.piapiGoogleSignInButton, 6000);

    if (!signInButton) {
      const trigger = await findFirstVisible(page, settings.selectors.piapiLoginTrigger, 4000);
      if (trigger) {
        log('info', 'Opening the login dialog');
        await trigger.click().catch(() => undefined);
        signInButton = await findFirstVisible(
          page,
          settings.selectors.piapiGoogleSignInButton,
          settings.actionTimeoutMs,
        );
      }
    }

    if (!signInButton) {
      const alreadyIn = await findFirstVisible(page, settings.selectors.piapiLoggedInMarker, 3000);
      if (alreadyIn) {
        log('info', 'An authenticated session already exists, skipping the Google login form');
      } else {
        return await fail(
          'Could not find the "Continue with Google" control, and the page does not look signed in. ' +
            'Adjust the sign-in selectors in Settings and inspect the page through the noVNC view.',
        );
      }
    } else {
      log('info', 'Clicking the Google sign-in control');
      const popupPromise = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
      await signInButton.click();

      const sameTab = await page
        .waitForURL(/accounts\.google\.com/i, { timeout: 6000 })
        .then(() => true)
        .catch(() => false);
      if (!sameTab) {
        oauthPopup = await popupPromise;
        if (oauthPopup) {
          page = oauthPopup;
          await page
            .waitForURL(/accounts\.google\.com/i, { timeout: settings.navigationTimeoutMs })
            .catch(() => undefined);
          log('info', 'Google OAuth opened in a popup window');
        }
      }
    }

    if (signal.aborted) return await fail('Cancelled during sign-in');

    if (/accounts\.google\.com/i.test(page.url())) {
      const outcome = await signInWithGoogle({ page, account, settings, log, fail });
      if (outcome) return outcome;
    }

    if (oauthPopup?.isClosed()) page = primaryPage;

    if (/error=access_denied/i.test(page.url())) {
      return await fail(
        'Google returned access_denied because the consent screen was dismissed instead of approved. ' +
          'Check the Google consent selector in Settings.',
      );
    }

    // NextAuth's CamelCase `AccessDenied` is different from the provider's
    // `access_denied`: OAuth succeeded and piapi.ai itself refused the account.
    if (/error=AccessDenied/.test(page.url())) {
      return await fail(
        'piapi.ai rejected this Google account after OAuth completed (NextAuth error=AccessDenied). ' +
          'The Google login worked, but PiAPI refused to create a session; retrying the same account will not help.',
        false,
      );
    }

    const nextAuthError = page.url().match(/[?&]error=([A-Za-z]+)/)?.[1];
    if (nextAuthError && !/access_denied/i.test(nextAuthError)) {
      return await fail(`piapi.ai returned an authentication error: ${nextAuthError}`, false);
    }

    if (signal.aborted) return await fail('Cancelled before the callback');

    log('info', 'Waiting for the OAuth callback to land back on piapi.ai');
    await page
      .waitForURL(new RegExp(baseDomain(settings.piapiBaseUrl).replace(/\./g, '\\.'), 'i'), {
        timeout: settings.navigationTimeoutMs,
      })
      .catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    if (oauthPopup && !primaryPage.isClosed()) page = primaryPage;

    // Reload the plain workspace so the check is not confused by the login dialog.
    await page
      .goto(`${settings.piapiBaseUrl.replace(/\/$/, '')}/workspace`, { waitUntil: 'networkidle' })
      .catch(() => undefined);
    await page.waitForTimeout(1500);

    // A visible "Log in" control is the ground truth: whatever cookies exist,
    // the account is not signed in while that button is on the page.
    const stillAnonymous = await findFirstVisible(page, settings.selectors.piapiLoginTrigger, 3000);
    if (stillAnonymous) {
      return await fail(
        'Google accepted the credentials but piapi.ai did not create a session (the page still shows "Log in"). ' +
          'Inspect the failure screenshot or open this account profile through noVNC.',
      );
    }

    const cookieToken = await extractCookieToken(context, settings);
    if (!cookieToken) {
      return await fail(
        'Signed in, but no piapi.ai session cookie matched. Add the right name to cookieTokenNames in Settings.',
      );
    }

    let apiKey: string | null = null;
    try {
      const keyResult = await ensurePiApiKey(context, settings.piapiBaseUrl);
      apiKey = keyResult.apiKey;
      log(
        'success',
        keyResult.created
          ? `Created and captured PiAPI API key "${keyResult.keyName}"`
          : `Captured PiAPI API key "${keyResult.keyName}"`,
      );
    } catch (err) {
      // The OAuth account is still valid even if PiAPI changes its key endpoint.
      // Keep the successful registration and allow a manual re-sync from the UI.
      log('warn', `Registration succeeded, but API key capture failed: ${condenseError(err)}`);
    }

    log('success', `Registration succeeded${apiKey ? ' (API key captured)' : ' (API key can be synced later)'}`);
    return {
      success: true,
      apiKey,
      cookieToken,
      message: 'Registration succeeded',
      screenshot: null,
    };
  } catch (err) {
    return await fail(`Unexpected failure: ${condenseError(err)}`);
  } finally {
    await session.close();
  }
}

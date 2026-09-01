export type AccountStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface Account {
  id: number
  username: string
  totpSecret: string
  recoveryEmail: string
  status: AccountStatus
  apiKey: string | null
  cookieToken: string | null
  attempts: number
  lastError: string | null
  screenshotPath: string | null
  createdAt: string
  updatedAt: string
}

export interface ApiKeySyncResult {
  requested: number
  synced: number
  skipped: number
  failed: number
  accounts: Account[]
  errors: Array<{ id: number; username: string; error: string }>
}

export type StatusCounts = Record<AccountStatus, number>

export interface RegistrationLog {
  id: number
  accountId: number | null
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
  createdAt: string
}

export interface ProxyEntry {
  id: string
  label: string
  /** A `{session}` placeholder is replaced per account to keep sticky sessions. */
  url: string
  enabled: boolean
}

export type ProxyStrategy = 'per-account' | 'round-robin' | 'random'

export interface ProxyPool {
  enabled: boolean
  strategy: ProxyStrategy
  entries: ProxyEntry[]
}

export interface ProxyTestResult {
  id: string
  label: string
  ok: boolean
  ip: string | null
  org: string | null
  country: string | null
  latencyMs: number
  error: string | null
}

export interface EgressInfo {
  ip: string | null
  city: string | null
  country: string | null
  org: string | null
  proxyConfigured: boolean
  proxyLabel: string | null
  profileKey: string
}

export interface SelectorSet {
  piapiLoginTrigger: string[]
  piapiGoogleSignInButton: string[]
  googleEmailField: string[]
  googleEmailNextButton: string[]
  googlePasswordField: string[]
  googlePasswordNextButton: string[]
  googleOtpField: string[]
  googleOtpSubmitButton: string[]
  googleWelcomeButton: string[]
  googleRecoveryChoice: string[]
  googleRecoveryEmailField: string[]
  googleRecoverySubmitButton: string[]
  googleConsentButton: string[]
  googleErrorText: string[]
  piapiLoggedInMarker: string[]
}

export interface AppSettings {
  maxConcurrent: number
  maxRetries: number
  navigationTimeoutMs: number
  actionTimeoutMs: number
  headless: boolean
  dryRun: boolean
  proxyPool: ProxyPool
  piapiBaseUrl: string
  piapiWorkspaceUrl: string
  cookieTokenNames: string[]
  selectors: SelectorSet
}

export interface QueueProgress {
  running: boolean
  total: number
  processed: number
  success: number
  failed: number
  active: string[]
}

export interface AuthSessionStatus {
  active: boolean
  accountId: number | null
  openedAt: string | null
  url: string | null
}

export interface RegisterStatus {
  progress: QueueProgress
  authSession: AuthSessionStatus
  novncUrl: string
}

export interface ParseError {
  line: number
  raw: string
  error: string
}

export interface BulkPreview {
  total: number
  valid: number
  errors: ParseError[]
  preview: Array<{
    username: string
    passwordMasked: string
    totpSecret: string
    recoveryEmail: string
  }>
}

export interface BulkImportResult {
  inserted: number
  updated: number
  skipped: number
  total: number
  rejected: number
  errors: ParseError[]
}

export interface LiveLogEntry {
  accountId: number | null
  username?: string
  level: RegistrationLog['level']
  message: string
  at: string
}

export type ServerEvent =
  | { type: 'progress'; payload: QueueProgress }
  | { type: 'log'; payload: LiveLogEntry }
  | { type: 'account'; payload: Account }
  | { type: 'queue-finished'; payload: QueueProgress }
  | { type: 'auth-session'; payload: { active: boolean; accountId: number | null; message: string } }

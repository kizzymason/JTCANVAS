import axios from 'axios'
import type {
  Account,
  ApiKeySyncResult,
  AppSettings,
  BulkImportResult,
  BulkPreview,
  EgressInfo,
  ProxyTestResult,
  QueueProgress,
  RegisterStatus,
  RegistrationLog,
  StatusCounts,
} from '../types'

/** Same-origin by default so the nginx container and the Vite proxy both work. */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

const http = axios.create({ baseURL: API_BASE, timeout: 30000 })

/** Surfaces the server's `error` field instead of a generic axios message. */
export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined
    if (data?.error) return data.error
    if (err.code === 'ECONNABORTED') return '请求超时'
    if (!err.response) return '无法连接后端服务'
    return `${err.response.status} ${err.response.statusText}`
  }
  return err instanceof Error ? err.message : String(err)
}

export const accountApi = {
  async list(status?: string): Promise<{ accounts: Account[]; counts: StatusCounts }> {
    const { data } = await http.get('/accounts', { params: status ? { status } : undefined })
    return data
  },

  async create(input: {
    username: string
    password: string
    totpSecret: string
    recoveryEmail: string
  }): Promise<Account> {
    const { data } = await http.post('/accounts', input)
    return data
  },

  async bulkPreview(text: string): Promise<BulkPreview> {
    const { data } = await http.post('/accounts/bulk/preview', { text })
    return data
  },

  async bulkImport(text: string): Promise<BulkImportResult> {
    const { data } = await http.post('/accounts/bulk', { text })
    return data
  },

  async update(id: number, patch: Partial<Account> & { password?: string }): Promise<Account> {
    const { data } = await http.patch(`/accounts/${id}`, patch)
    return data
  },

  async remove(id: number): Promise<void> {
    await http.delete(`/accounts/${id}`)
  },

  async bulkDelete(ids: number[]): Promise<{ deleted: number }> {
    const { data } = await http.post('/accounts/bulk-delete', { ids })
    return data
  },

  async deleteByStatus(status: string): Promise<{ deleted: number }> {
    const { data } = await http.post('/accounts/bulk-delete', { status })
    return data
  },

  async reset(from: string): Promise<{ reset: number }> {
    const { data } = await http.post('/accounts/reset', { from })
    return data
  },

  async totp(id: number): Promise<{ code: string; secondsRemaining: number }> {
    const { data } = await http.get(`/accounts/${id}/totp`)
    return data
  },

  async logs(id: number): Promise<RegistrationLog[]> {
    const { data } = await http.get(`/accounts/${id}/logs`)
    return data
  },

  async syncApiKey(id: number): Promise<Account> {
    const { data } = await http.post(
      `/accounts/${id}/api-key`,
      {},
      { timeout: 120000 },
    )
    return data.account
  },

  async syncApiKeys(ids?: number[], force = false): Promise<ApiKeySyncResult> {
    const { data } = await http.post(
      '/accounts/api-keys/sync',
      { ...(ids ? { ids } : {}), force },
      { timeout: 600000 },
    )
    return data
  },
}

export const registerApi = {
  async status(): Promise<RegisterStatus> {
    const { data } = await http.get('/register/status')
    return data
  },

  async start(accountIds?: number[]): Promise<{ started: boolean; total: number }> {
    const { data } = await http.post('/register/start', accountIds ? { accountIds } : {})
    return data
  },

  async stop(): Promise<{ stopped: boolean }> {
    const { data } = await http.post('/register/stop')
    return data
  },

  async openAuthSession(accountId: number): Promise<{ url: string; novncUrl: string; accountId: number }> {
    const { data } = await http.post('/register/auth-session', { accountId })
    return data
  },

  async completeAuthSession(): Promise<{ saved: boolean; cookies: number }> {
    const { data } = await http.post('/register/auth-session/complete')
    return data
  },

  async cancelAuthSession(): Promise<void> {
    await http.delete('/register/auth-session')
  },

  async verifyTotp(secret: string): Promise<{ code: string; secondsRemaining: number }> {
    const { data } = await http.post('/register/verify-totp', { secret })
    return data
  },
}

export const settingsApi = {
  async get(): Promise<{ settings: AppSettings; defaults: AppSettings }> {
    const { data } = await http.get('/settings')
    return data
  },

  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const { data } = await http.put('/settings', patch)
    return data.settings
  },

  async reset(): Promise<AppSettings> {
    const { data } = await http.post('/settings/reset')
    return data.settings
  },

  async clearCompleted(): Promise<{ deleted: number }> {
    const { data } = await http.post('/settings/clear-completed')
    return data
  },

  async clearBrowser(): Promise<void> {
    await http.post('/settings/clear-browser')
  },

  async clearLogs(): Promise<void> {
    await http.post('/settings/clear-logs')
  },

  async clearProfiles(): Promise<{ deleted: number }> {
    const { data } = await http.post('/settings/clear-profiles')
    return data
  },

  async egressIp(profileKey?: string): Promise<EgressInfo> {
    const { data } = await http.get('/settings/egress-ip', {
      timeout: 120000,
      params: profileKey ? { profileKey } : undefined,
    })
    return data
  },

  async testProxyPool(): Promise<ProxyTestResult[]> {
    // Entries are probed one at a time server-side, so allow for a slow pool.
    const { data } = await http.post('/settings/proxy-test', {}, { timeout: 300000 })
    return data.results
  },

  async testProxy(id: string): Promise<ProxyTestResult> {
    const { data } = await http.post(`/settings/proxy-test/${encodeURIComponent(id)}`, {}, { timeout: 90000 })
    return data.result
  },

  async clearScreenshots(): Promise<{ deleted: number }> {
    const { data } = await http.post('/settings/clear-screenshots')
    return data
  },
}

export const systemApi = {
  async health(): Promise<{ status: string; timestamp: string }> {
    const { data } = await http.get('/health')
    return data
  },

  async progress(): Promise<QueueProgress> {
    const { data } = await http.get('/progress')
    return data
  },

  async logs(limit = 300): Promise<RegistrationLog[]> {
    const { data } = await http.get('/logs', { params: { limit } })
    return data.logs
  },
}

export function downloadUrl(format: 'csv' | 'json' | 'txt', params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString()
  return `${API_BASE}/export/${format}${query ? `?${query}` : ''}`
}

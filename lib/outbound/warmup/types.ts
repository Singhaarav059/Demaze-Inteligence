// ============================================================
// Email Warm-Up — Shared Types
// ============================================================
// Same provider-abstraction template as the other outbound capabilities.
// Providers are stateless — startedAt/isPaused are passed in from the
// caller (outbound_warmup_mailboxes owns that state) so the mock can
// compute a deterministic function of elapsed time without its own storage.
// ============================================================

export type WarmupStatus = 'not_started' | 'warming' | 'warmed' | 'paused'

export interface WarmupStatusRequest {
  mailboxAddress: string
  startedAt: string // ISO timestamp
  isPaused?: boolean
}

export interface WarmupStatusResult {
  status: WarmupStatus
  emailsSentTotal: number
  inboxRate: number // 0-1
  spamRate: number // 0-1
  domainHealthScore: number // 0-100
  providerUsed: string
}

export interface WarmupProvider {
  name: string
  displayName: string
  startWarmup(mailboxAddress: string): Promise<{ started: boolean }>
  getWarmupStatus(request: WarmupStatusRequest): Promise<WarmupStatusResult>
  isAvailable(): Promise<boolean>
}

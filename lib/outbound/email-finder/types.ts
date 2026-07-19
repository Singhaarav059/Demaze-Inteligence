// ============================================================
// Email Finder — Shared Types
// ============================================================
// Mirrors lib/ai/types.ts's AIProvider template: every implementation
// (mock now, a real vendor like Hunter/Apollo/Findymail/Snov later)
// satisfies this interface. Never invents a person — the caller supplies
// personName; this module only resolves it to a probable email address.
// ============================================================

export interface EmailFinderRequest {
  personName: string
  companyName: string
  domain: string
}

export type EmailFinderConfidence = 'high' | 'medium' | 'low' | 'none'
export type EmailFinderStatus = 'found' | 'not_found' | 'error'

export interface EmailFinderResult {
  email: string | null
  confidence: EmailFinderConfidence
  providerUsed: string
  status: EmailFinderStatus
  reason?: string
}

export interface EmailFinderProvider {
  name: string
  displayName: string
  findEmail(request: EmailFinderRequest): Promise<EmailFinderResult>
  isAvailable(): Promise<boolean>
}

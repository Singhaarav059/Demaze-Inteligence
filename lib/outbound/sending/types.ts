// ============================================================
// Email Sending — Shared Types
// ============================================================
// Same provider-abstraction template as the other outbound capabilities.
// Providers are stateless/pure — they never touch the database themselves;
// the API routes (which own outbound_campaigns/_contacts/_events) persist
// whatever a provider call returns. This is mock-only today: no real SMTP,
// no real send. Building the capability now does not imply standing
// authorization to send to real prospects once a real provider exists —
// see CLAUDE.md's "Outbound Workflow Modules" section.
// ============================================================

export interface SendEmailRequest {
  campaignId: string
  contactEmail: string
  subject: string
  body: string
  fromAddress?: string
  // Threading (added 2026-07-29 for follow-up scheduling, see
  // followup-schedule.ts): lets a provider that supports it (Gmail) group
  // this send into an existing conversation instead of starting a new one.
  // Providers without a threading concept (mock) just ignore both.
  threadId?: string
  inReplyTo?: string
  // Open tracking (2026-08-05) — outbound_campaign_contacts.id for this
  // specific send. Only the Gmail provider uses it (to embed a tracking
  // pixel pointed at app/api/track/open/[campaignContactId]); providers
  // without an HTML-body concept (mock) ignore it. Optional because a send
  // with no known campaign_contact row yet (there isn't one) simply gets no
  // pixel — same graceful-degradation shape as every other optional field
  // here.
  campaignContactId?: string
}

// 'suppressed' (Session 3, suppression list) means sendEmail() refused to
// even attempt the send because the recipient is on
// outbound_suppression_list — never something a provider itself returns.
export type SendEmailStatus = 'sent' | 'queued' | 'failed' | 'suppressed'

export interface SendEmailResult {
  status: SendEmailStatus
  providerMessageId?: string
  providerUsed: string
  error?: string
}

export interface FollowupToSchedule {
  subject: string
  body: string
  sendAfterHours: number
}

export interface ScheduleFollowupsRequest {
  campaignId: string
  contactEmail: string
  followups: FollowupToSchedule[]
}

export interface ScheduleFollowupsResult {
  scheduled: boolean
  providerUsed: string
}

export interface EmailSenderProvider {
  name: string
  displayName: string
  sendEmail(request: SendEmailRequest): Promise<SendEmailResult>
  scheduleFollowups(request: ScheduleFollowupsRequest): Promise<ScheduleFollowupsResult>
  pauseCampaign(campaignId: string): Promise<{ paused: boolean }>
  resumeCampaign(campaignId: string): Promise<{ resumed: boolean }>
  isAvailable(): Promise<boolean>
}

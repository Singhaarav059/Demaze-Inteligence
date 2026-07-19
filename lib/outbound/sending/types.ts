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
}

export type SendEmailStatus = 'sent' | 'queued' | 'failed'

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

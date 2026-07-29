// ============================================================
// Outbound Integrations — Shared Types
// ============================================================
// One capability = one pluggable vendor slot. Every outbound module
// (email finder, validation, enrichment, sending, warmup) reads its
// active provider through this shared shape, never a hardcoded vendor.
// ============================================================

export type OutboundCapability =
  | 'decision_maker_discovery'
  | 'email_finder'
  | 'enrichment'
  | 'sending'
  | 'warmup'

export const OUTBOUND_CAPABILITIES: OutboundCapability[] = [
  'decision_maker_discovery',
  'email_finder',
  'enrichment',
  'sending',
  'warmup',
]

export const CAPABILITY_LABELS: Record<OutboundCapability, string> = {
  decision_maker_discovery: 'Decision-Maker Discovery',
  email_finder: 'Email Finder',
  enrichment: 'Contact Enrichment',
  sending: 'Email Sending',
  warmup: 'Email Warm-Up',
}

export const CAPABILITY_HINTS: Record<OutboundCapability, string> = {
  decision_maker_discovery: 'Given a company + target titles, finds candidate decision-makers (name + title).',
  email_finder: 'Resolves a person + company into a likely email address.',
  enrichment: 'Adds department, seniority, location, and company context for a contact.',
  sending: 'Sends and schedules outreach emails through a sending provider.',
  warmup: 'Tracks domain/inbox health for sending mailboxes.',
}

// Known future vendors per capability, shown as selectable options in the
// settings UI even before a real provider class exists for them. Selecting
// one that has no real implementation yet simply has no effect other than
// recording the choice — the factory always falls back to 'mock' behavior
// until that vendor's provider class is added.
export const CAPABILITY_KNOWN_PROVIDERS: Record<OutboundCapability, string[]> = {
  decision_maker_discovery: ['mock', 'prospeo', 'apollo', 'proxycurl'],
  email_finder: ['mock', 'prospeo', 'hunter', 'apollo', 'findymail', 'snov'],
  enrichment: ['mock', 'prospeo', 'apollo', 'proxycurl'],
  sending: ['mock', 'gmail', 'smartlead', 'instantly'],
  warmup: ['mock', 'smartlead', 'instantly'],
}

export type IntegrationTestStatus = 'success' | 'failure' | 'untested'

// Row shape as returned to the browser — never includes credential_encrypted.
export interface OutboundIntegrationRow {
  id: string
  capability: OutboundCapability
  provider_name: string
  display_name: string
  is_enabled: boolean
  is_active: boolean
  credential_last_four: string | null
  config: Record<string, unknown>
  last_tested_at: string | null
  last_test_status: IntegrationTestStatus
  last_test_message: string | null
  created_at: string
  updated_at: string
}

export function isOutboundCapability(value: string): value is OutboundCapability {
  return (OUTBOUND_CAPABILITIES as string[]).includes(value)
}

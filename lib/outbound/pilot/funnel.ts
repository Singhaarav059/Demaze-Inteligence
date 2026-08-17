// ============================================================
// Pilot Observability — company funnel, failure funnel, per-company trace
// ============================================================
// Post-Hardening Pilot Readiness Plan, Phase D. Pure aggregation over
// already-persisted data — no new tables, no new taxonomy. Reuses:
//   - send-eligibility.ts's checkEmailFormat/checkCompanyIdentity (the same
//     B4/B6 checks the real send routes enforce) for "QA passed"/"QA failure"
//   - normalize.ts's own evidence_sufficiency/icp_sufficiency/
//     validation_warnings fields (already computed and saved per run) for
//     "research warnings"/"ICP failure" — NOT the richer per-stage gate
//     reasonCode taxonomy, which is computed live but never persisted to
//     pipeline_test_runs (see the verification report for this gap)
//   - outbound_campaign_events' existing event_type enum
//     (send_failed/send_ambiguous/suppressed/bounced/replied/opened) for
//     send-side outcomes
// This module never touches Supabase directly — the route fetches rows and
// shapes them into the input types below, same split as followup-schedule.ts
// (pure) vs. process-followup.ts (impure) elsewhere in this codebase.
// ============================================================

import { checkEmailFormat, checkCompanyIdentity } from '../sending/send-eligibility'

export interface PilotContactInput {
  contactId: string
  personName: string | null
  email: string | null
  discoveryGroundingStatus: string | null
  hasGeneratedDraft: boolean
  hasUnsupportedClaim: boolean
  campaignContactStatus: string | null // null = never enqueued into a campaign
  openedAt: string | null
  suppressed: boolean
  suppressionReason: string | null
  hadSendFailure: boolean
  hadSendAmbiguous: boolean
}

export interface PilotCompanyRunInput {
  runId: string
  domain: string | null
  companyUrl: string | null
  createdAt: string
  companyName: string | null
  whyNow: string | null
  whatToSell: string | null
  evidenceSufficiency: string | null
  validationWarningsCount: number
  opportunitiesCount: number
  topOpportunityTitle: string | null
  icpSegmentsCount: number
  icpSufficiency: string | null
  contacts: PilotContactInput[]
}

// A contact "passes QA" using the exact same non-overridable checks the
// real send routes enforce (docs/outbound-safety-policy.md, B4/B5/B6) — not
// a separately-invented pilot-only notion of "good enough."
function contactPassesQA(c: PilotContactInput): boolean {
  if (!c.hasGeneratedDraft) return false
  if (checkEmailFormat(c.email).blocked) return false
  if (checkCompanyIdentity(c.discoveryGroundingStatus).blocked) return false
  if (c.hasUnsupportedClaim) return false
  return true
}

// "Approved" = at least one contact reached a real campaign — enqueueing
// only happens after a human clicks Send on the Review & Send screen
// (Rule 7, human approval), so campaign membership IS the approval signal;
// there's no separate "approved" flag to invent.
const SENT_ISH = new Set(['sent', 'followup_1', 'followup_2', 'followup_3', 'replied', 'bounced', 'stopped'])

export interface PilotCompanyTrace {
  runId: string
  companyName: string
  domain: string | null
  companyUrl: string | null
  createdAt: string
  whyThisCompany: string | null
  whyNow: string | null
  evidenceSufficiency: string | null
  opportunity: string | null
  decisionMakerFound: boolean
  whyThisPerson: string | null // grounding status of the contact actually used, if any
  email: string | null
  qaStatus: 'passed' | 'failed' | 'not_attempted'
  sendStatus: 'sent' | 'queued_not_sent' | 'not_approved'
  outcome: 'replied' | 'bounced' | 'opened' | 'no_reply_yet' | 'n/a'
}

export function buildCompanyTrace(run: PilotCompanyRunInput): PilotCompanyTrace {
  const primaryContact =
    run.contacts.find(c => contactPassesQA(c)) ??
    run.contacts.find(c => c.email) ??
    run.contacts[0] ??
    null

  const anySent = run.contacts.some(c => c.campaignContactStatus && SENT_ISH.has(c.campaignContactStatus))
  const anyApproved = run.contacts.some(c => c.campaignContactStatus !== null)
  const anyQAAttempted = run.contacts.some(c => c.hasGeneratedDraft)
  const anyQAPassed = run.contacts.some(c => contactPassesQA(c))

  const anyReplied = run.contacts.some(c => c.campaignContactStatus === 'replied')
  const anyBounced = run.contacts.some(c => c.campaignContactStatus === 'bounced')
  const anyOpened = run.contacts.some(c => c.openedAt !== null)

  return {
    runId: run.runId,
    companyName: run.companyName ?? run.domain ?? run.runId,
    domain: run.domain,
    companyUrl: run.companyUrl,
    createdAt: run.createdAt,
    whyThisCompany: run.whatToSell,
    whyNow: run.whyNow,
    evidenceSufficiency: run.evidenceSufficiency,
    opportunity: run.topOpportunityTitle,
    decisionMakerFound: run.contacts.length > 0,
    whyThisPerson: primaryContact?.discoveryGroundingStatus ?? null,
    email: primaryContact?.email ?? null,
    qaStatus: anyQAPassed ? 'passed' : anyQAAttempted ? 'failed' : 'not_attempted',
    sendStatus: anySent ? 'sent' : anyApproved ? 'queued_not_sent' : 'not_approved',
    outcome: anyReplied ? 'replied' : anyBounced ? 'bounced' : anyOpened ? 'opened' : anySent ? 'no_reply_yet' : 'n/a',
  }
}

export interface PilotFunnelCounts {
  companiesEntered: number
  researchCompleted: number
  researchWarnings: number
  validOpportunities: number
  icpMatched: number
  decisionMakerFound: number
  emailFound: number
  emailQAPassed: number
  approved: number
  sent: number
  replied: number
}

export function computeFunnel(runs: PilotCompanyRunInput[]): PilotFunnelCounts {
  const traces = runs.map(buildCompanyTrace)
  return {
    companiesEntered: runs.length,
    // Same value as companiesEntered today — every persisted row IS a
    // completed run (a failed/crashed attempt is never saved at all, see
    // the "research failure" note in computeFailures below). Kept as a
    // separate field, not collapsed into companiesEntered, so this
    // equivalence is visible rather than silently assumed.
    researchCompleted: runs.length,
    researchWarnings: runs.filter(r => r.validationWarningsCount > 0 || r.evidenceSufficiency === 'insufficient').length,
    validOpportunities: runs.filter(r => r.opportunitiesCount > 0).length,
    icpMatched: runs.filter(r => r.icpSegmentsCount > 0).length,
    decisionMakerFound: runs.filter(r => r.contacts.length > 0).length,
    emailFound: runs.filter(r => r.contacts.some(c => c.email)).length,
    emailQAPassed: traces.filter(t => t.qaStatus === 'passed').length,
    approved: traces.filter(t => t.sendStatus !== 'not_approved').length,
    sent: traces.filter(t => t.sendStatus === 'sent').length,
    replied: traces.filter(t => t.outcome === 'replied').length,
  }
}

export interface PilotFailureCounts {
  relevanceOrEvidenceFailure: number
  identityFailure: number
  icpFailure: number
  peopleDataFailure: number
  emailFailure: number
  qaFailure: number
  sendFailure: number
  suppression: number
}

export function computeFailures(runs: PilotCompanyRunInput[]): PilotFailureCounts {
  return {
    relevanceOrEvidenceFailure: runs.filter(r => r.evidenceSufficiency === 'insufficient').length,
    identityFailure: runs.filter(r => r.contacts.some(c => c.discoveryGroundingStatus === 'conflict')).length,
    icpFailure: runs.filter(r => r.icpSufficiency === 'insufficient').length,
    peopleDataFailure: runs.filter(r => r.contacts.length === 0).length,
    emailFailure: runs.filter(r => r.contacts.length > 0 && !r.contacts.some(c => c.email)).length,
    qaFailure: runs.filter(r => r.contacts.some(c => c.hasGeneratedDraft) && !r.contacts.some(c => contactPassesQA(c))).length,
    sendFailure: runs.filter(r => r.contacts.some(c => c.hadSendFailure || c.hadSendAmbiguous)).length,
    suppression: runs.filter(r => r.contacts.some(c => c.suppressed)).length,
  }
}

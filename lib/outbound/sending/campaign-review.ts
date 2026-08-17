// ============================================================
// Campaign Review — shared ready/missing-email/suppressed/already-sent
// classification (Review & Send screen + the step-6 dashboard's "Queued"
// segment both need the exact same answer, so this is computed once here
// rather than twice with a risk of the two screens disagreeing).
// ============================================================
// Contacts don't need to already be enqueued in outbound_campaign_contacts
// to be classified — Review & Send runs BEFORE enqueue (enqueue happens as
// part of "Confirm & Send"), so this reads outbound_contacts +
// outbound_generated_content + the suppression list directly, and only
// additionally checks outbound_campaign_contacts to catch a contact that
// was already sent to in an earlier partial send of this same campaign
// (e.g. a resumed session).
// ============================================================

import type { createServerClient } from '@/lib/supabase/server'
import { isSuppressed } from './suppression'
import { checkEmailFormat, checkCompanyIdentity } from './send-eligibility'

// 'blocked' (Phase B, safety policy) is distinct from 'missing_email'/
// 'not_ready' — there IS a real email and a real drafted email, but a
// non-overridable safety check refused it (invalid email syntax, a company-
// identity conflict, or an unsupported factual claim in the draft). See
// docs/outbound-safety-policy.md.
export type ContactReviewStatus = 'ready' | 'missing_email' | 'suppressed' | 'already_sent' | 'not_ready' | 'blocked'
export type BlockReason = 'invalid_email_format' | 'company_identity_mismatch' | 'unsupported_claim'

export interface ContactReviewRow {
  contactId: string
  personName: string
  email: string | null
  status: ContactReviewStatus
  reason?: string
  suppressionReason?: 'bounced' | 'unsubscribed' | 'manual'
  campaignContactId?: string // present only when already enqueued (already_sent, or a stray queued row from a prior partial send)
  campaignContactStatus?: string
  // Additive, informational only (audit follow-up) — never a gate. A
  // 'low'-confidence email already passes every check above (it's a real,
  // non-null email address on the contact), so it still becomes 'ready';
  // this just carries the finder's own confidence through so Review & Send
  // — the last checkpoint before a real send — can show the same "needs
  // verification" signal the Contact Info step (ContactInfoRow.tsx)
  // already shows earlier in the flow, instead of that signal disappearing
  // once a contact reaches this screen.
  emailConfidence?: 'high' | 'medium' | 'low' | 'none' | null
  // Additive, informational only (Master Plan Phase 5, Step 5.4 — company
  // identity check) — never a gate. A 'conflict'/'not_found' grounding
  // result still becomes 'ready' like any other contact with a real email
  // and a drafted email; this carries the discovery-time website-grounding
  // signal (lib/outbound/decision-maker-discovery/grounding.ts) through so
  // Review & Send — the last checkpoint before a real send — can warn a
  // human reviewer instead of that signal disappearing after discovery.
  discoveryGroundingStatus?: 'confirmed' | 'conflict' | 'not_found' | null
  discoveryGroundingReason?: string | null
  // Only set when status === 'blocked' — which of the B4/B5/B6 checks fired.
  blockReason?: BlockReason
}

export interface CampaignReviewSummary {
  total: number
  ready: number
  missingEmail: number
  suppressed: number
  alreadySent: number
  notReady: number
  blocked: number
  rows: ContactReviewRow[]
}

export async function classifyCampaignContacts(
  supabase: ReturnType<typeof createServerClient>,
  campaignId: string,
  contactIds: string[]
): Promise<CampaignReviewSummary> {
  if (contactIds.length === 0) {
    return { total: 0, ready: 0, missingEmail: 0, suppressed: 0, alreadySent: 0, notReady: 0, blocked: 0, rows: [] }
  }

  const [{ data: contacts }, { data: generatedRows }, { data: campaignContactRows }] = await Promise.all([
    supabase.from('outbound_contacts').select('id, person_name, email, email_confidence, discovery_grounding_status, discovery_grounding_reason').in('id', contactIds),
    supabase.from('outbound_generated_content').select('contact_id, selected_subject_line, email_draft').in('contact_id', contactIds),
    supabase.from('outbound_campaign_contacts').select('id, contact_id, status').eq('campaign_id', campaignId).in('contact_id', contactIds),
  ])

  const generatedByContact = new Map((generatedRows ?? []).map(g => [g.contact_id, g]))
  const campaignContactByContact = new Map((campaignContactRows ?? []).map(cc => [cc.contact_id, cc]))

  const rows: ContactReviewRow[] = []
  for (const contactId of contactIds) {
    const contact = (contacts ?? []).find(c => c.id === contactId)
    const personName = contact?.person_name ?? 'Unknown contact'
    const email = contact?.email ?? null
    const existingCc = campaignContactByContact.get(contactId)

    if (existingCc && existingCc.status !== 'queued') {
      rows.push({
        contactId, personName, email, status: 'already_sent',
        reason: `Already ${existingCc.status === 'sent' ? 'sent' : existingCc.status}.`,
        campaignContactId: existingCc.id, campaignContactStatus: existingCc.status,
      })
      continue
    }

    if (!email) {
      rows.push({ contactId, personName, email, status: 'missing_email', reason: 'No email address on file.', campaignContactId: existingCc?.id })
      continue
    }

    // B6 — invalid email format. A missing email was already caught above;
    // this catches a PRESENT but syntactically malformed one, never checked
    // before Phase B. No override (docs/outbound-safety-policy.md).
    const emailFormatCheck = checkEmailFormat(email)
    if (emailFormatCheck.blocked) {
      rows.push({
        contactId, personName, email, status: 'blocked', reason: emailFormatCheck.reason,
        blockReason: 'invalid_email_format', campaignContactId: existingCc?.id,
      })
      continue
    }

    // B4 — decision-maker company identity mismatch. Only 'conflict' blocks
    // — see send-eligibility.ts's own comment for why 'not_found' stays
    // advisory. No override.
    const identityCheck = checkCompanyIdentity(contact?.discovery_grounding_status ?? null)
    if (identityCheck.blocked) {
      rows.push({
        contactId, personName, email, status: 'blocked', reason: identityCheck.reason,
        blockReason: 'company_identity_mismatch', campaignContactId: existingCc?.id,
      })
      continue
    }

    const suppression = await isSuppressed(email)
    if (suppression.suppressed) {
      rows.push({
        contactId, personName, email, status: 'suppressed',
        reason: suppression.detail ?? `On the suppression list (${suppression.reason}).`,
        suppressionReason: suppression.reason,
        campaignContactId: existingCc?.id,
      })
      continue
    }

    const generated = generatedByContact.get(contactId)
    const emailDraft = generated?.email_draft as { fullText?: string; claimGroundingCheck?: { hasUnsupportedClaim?: boolean; reason?: string } } | null
    if (!generated?.selected_subject_line || !emailDraft?.fullText) {
      rows.push({ contactId, personName, email, status: 'not_ready', reason: 'No generated email drafted yet.', campaignContactId: existingCc?.id })
      continue
    }

    // B5 — unsupported factual claim. Computed once at generation time
    // (generate-email route) and stored on the draft; absent (drafts
    // generated before this field existed) is treated as passing, same
    // graceful-degradation contract as every other optional field here. No
    // override.
    if (emailDraft.claimGroundingCheck?.hasUnsupportedClaim) {
      rows.push({
        contactId, personName, email, status: 'blocked',
        reason: emailDraft.claimGroundingCheck.reason ?? 'This draft contains an unsupported factual claim.',
        blockReason: 'unsupported_claim', campaignContactId: existingCc?.id,
      })
      continue
    }

    rows.push({
      contactId, personName, email, status: 'ready', campaignContactId: existingCc?.id,
      emailConfidence: contact?.email_confidence ?? null,
      discoveryGroundingStatus: contact?.discovery_grounding_status ?? null,
      discoveryGroundingReason: contact?.discovery_grounding_reason ?? null,
    })
  }

  return {
    total: rows.length,
    ready: rows.filter(r => r.status === 'ready').length,
    missingEmail: rows.filter(r => r.status === 'missing_email').length,
    suppressed: rows.filter(r => r.status === 'suppressed').length,
    alreadySent: rows.filter(r => r.status === 'already_sent').length,
    notReady: rows.filter(r => r.status === 'not_ready').length,
    blocked: rows.filter(r => r.status === 'blocked').length,
    rows,
  }
}

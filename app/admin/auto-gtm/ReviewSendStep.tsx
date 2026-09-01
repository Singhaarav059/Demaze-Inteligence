'use client'

// ============================================================
// ReviewSendStep - Auto Flow step 5, "Review & Send"
// ============================================================
// New step (2026-08-12, 5→6 restructure) - the ONE place in Auto Flow that
// actually sends. Everything here is read/classify-only until the final
// "Confirm & Send" action: counts (ready / missing email / suppressed /
// already sent), a per-contact list with Preview/Edit/Remove, then one
// explicit confirmation before anything goes out - reuses
// useAutoGtmFlow's existing sendOneContact/sendSelectedContacts (already
// idempotent, already enqueue-then-send) rather than duplicating send logic.
//
// Classification comes from the shared lib/outbound/sending/
// campaign-review.ts (via GET campaigns/[id]/review) - the SAME classifier
// the step-6 dashboard's "Queued" segment uses, so the two screens can
// never disagree about what's ready to send.
//
// "Remove" before Confirm & Send is mostly a LOCAL exclude (nothing has
// been enqueued yet at this point in the flow - enqueue happens as part of
// Confirm & Send itself), tracked in excludedIds. It only calls the real
// DELETE .../contacts/[contactId] route for the rarer case where this
// contact already has a leftover 'queued' campaign_contacts row from an
// earlier partial send in this same resumed session.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { InfoTooltip } from '@/components/ui/tooltip'
import { humanizeText } from '@/lib/text/humanize'
import { EmptyState } from '@/components/ui/empty-state'
import {
  ConfirmDialog,
  AlertDialog,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from '@/components/ui/alert-dialog'
import { Mail } from 'lucide-react'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'
import type { OutboundIntegrationRow } from '@/lib/outbound/settings/types'
import type { ContactReviewStatus } from '@/lib/outbound/sending/campaign-review'
import type { QualificationResult } from '@/lib/sector-playbook/qualify'
import { IntelStatus, type IntelStatusKind } from '@/components/ui/intel-status'
import { CompactSectorBadge } from './SectorQualificationCard'

interface SendOutcomeDetail {
  status: 'sent' | 'skipped' | 'failed' | 'ambiguous' | 'blocked'
  reason?: string
}

interface ReviewRow {
  contactId: string
  personName: string
  email: string | null
  status: ContactReviewStatus
  reason?: string
  suppressionReason?: 'bounced' | 'unsubscribed' | 'manual'
  campaignContactId?: string
  campaignContactStatus?: string
  // Informational only - see campaign-review.ts's own comment on this
  // field. A 'low' value never changes `status`, it's shown as an
  // additional badge on an otherwise-'ready' row.
  emailConfidence?: 'high' | 'medium' | 'low' | 'none' | null
  // Informational only, same discipline as emailConfidence above - see
  // campaign-review.ts's comment. 'conflict'/'not_found' never changes
  // `status`, it's surfaced as an additional badge + a confirm-dialog
  // warning (Master Plan Phase 5, Step 5.4).
  discoveryGroundingStatus?: 'confirmed' | 'conflict' | 'not_found' | null
  discoveryGroundingReason?: string | null
  // Only set when status === 'blocked' (Phase B safety policy, non-
  // overridable - see campaign-review.ts).
  blockReason?: 'invalid_email_format' | 'company_identity_mismatch' | 'unsupported_claim'
}

interface ReviewSummary {
  total: number
  ready: number
  missingEmail: number
  suppressed: number
  alreadySent: number
  notReady: number
  blocked: number
  rows: ReviewRow[]
}

interface CampaignInfo {
  id: string
  name: string
}

// Maps each real review outcome onto IntelStatus's shared status
// vocabulary/dot color - same classifier output as before
// (campaign-review.ts), only the rendering primitive changed.
const STATUS_META: Record<ContactReviewStatus, { label: string; status: IntelStatusKind }> = {
  ready: { label: 'Ready', status: 'complete' },
  missing_email: { label: 'No email', status: 'not_researched' },
  suppressed: { label: 'Suppressed', status: 'failed' },
  already_sent: { label: 'Already sent', status: 'already_researched' },
  not_ready: { label: 'Needs a draft', status: 'needs_review' },
  blocked: { label: 'Blocked', status: 'failed' },
}

function StatChip({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'strong' | 'medium' | 'destructive'
}) {
  const valueClass =
    tone === 'strong'
      ? 'text-signal-strong'
      : tone === 'medium'
        ? 'text-signal-medium'
        : tone === 'destructive'
          ? 'text-destructive'
          : 'text-foreground'
  return (
    <div className="rounded-lg bg-background/50 px-2.5 py-2">
      <span className="block text-[11px] text-muted-foreground/60">{label}</span>
      <span className={`block text-base font-semibold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  )
}

export function ReviewSendStep({
  contacts,
  qualification,
  researchQualityFlagged,
  campaignId,
  ensureCampaignId,
  campaignContactStatus,
  sendingContactId,
  sendingSelected,
  sendOneContact,
  sendSelectedContacts,
  excludedIds,
  onExcludedIdsChange,
  onEditContact,
}: {
  contacts: OutboundContact[]
  qualification: QualificationResult | null
  // Count of items_flagged from lib/pipeline/research-quality.ts's
  // auditResearchQuality() for this company's research (Master Plan Phase 5,
  // Step 5.5 - confidence gate). That function is informational-only and
  // never gates anything itself; this is the send-time surface for it. Null
  // when no research is loaded yet.
  researchQualityFlagged?: number | null
  campaignId: string | null
  ensureCampaignId: () => Promise<string | null>
  campaignContactStatus: Record<string, SendOutcomeDetail>
  sendingContactId: string | null
  sendingSelected: boolean
  sendOneContact: (contactId: string) => Promise<void>
  sendSelectedContacts: (contactIds: string[]) => Promise<void>
  // Lifted to the parent page (audit follow-up, 2026-08-24) - this step's
  // own local state used to reset on every remount (step 5 remounts on
  // every step change), silently un-removing anyone the user had excluded
  // if they navigated away and back before confirming send.
  excludedIds: Set<string>
  onExcludedIdsChange: (ids: Set<string>) => void
  onEditContact: (contactId?: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null)
  const [summary, setSummary] = useState<ReviewSummary | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ personName: string; subject: string; body: string; loading: boolean; notFound: boolean } | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState(false)
  const [sendingProviderName, setSendingProviderName] = useState<string | null>(null)

  const contactIdsKey = useMemo(() => contacts.map(c => c.id).join(','), [contacts])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const id = campaignId ?? (await ensureCampaignId())
      if (!id || contacts.length === 0) {
        setLoading(false)
        return
      }
      const res = await fetch(`/api/admin/outbound/campaigns/${id}/review?contact_ids=${contactIdsKey}`)
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Could not load campaign review')
        return
      }
      setCampaign(data.campaign)
      setSummary(data.summary)
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, contactIdsKey])

  useEffect(() => {
    // Intentional fetch-on-mount/on-dependency-change, not a derived-state
    // anti-pattern - same precedent as this codebase's other self-fetching
    // step components.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/outbound/integrations')
        const data = await res.json()
        if (!data.success) return
        const row = (data.integrations as OutboundIntegrationRow[]).find(r => r.capability === 'sending' && r.is_active)
        setSendingProviderName(row?.provider_name ?? 'mock')
      } catch {
        setSendingProviderName('mock')
      }
    })()
  }, [])

  const isRealSendingProvider = sendingProviderName !== null && sendingProviderName !== 'mock'

  // A row's live status can move past 'ready' during THIS session (a
  // per-contact "Send Email" click below) even though the last /review
  // fetch hasn't re-run - campaignContactStatus (from useAutoGtmFlow,
  // updated immediately after every send) is the more current source for
  // "already sent," checked first.
  const rowsWithLiveStatus = useMemo(() => {
    if (!summary) return []
    return summary.rows
      .filter(r => !excludedIds.has(r.contactId))
      .map(r => {
        const outcome = campaignContactStatus[r.contactId]
        if (outcome?.status === 'sent' && r.status === 'ready') {
          return { ...r, status: 'already_sent' as const, reason: 'Sent.' }
        }
        return r
      })
  }, [summary, excludedIds, campaignContactStatus])

  const readyRows = rowsWithLiveStatus.filter(r => r.status === 'ready')
  const groundingIssueCount = readyRows.filter(
    r => r.discoveryGroundingStatus === 'conflict' || r.discoveryGroundingStatus === 'not_found'
  ).length
  const missingEmailRows = rowsWithLiveStatus.filter(r => r.status === 'missing_email')
  const suppressedRows = rowsWithLiveStatus.filter(r => r.status === 'suppressed')
  const alreadySentRows = rowsWithLiveStatus.filter(r => r.status === 'already_sent')
  const notReadyRows = rowsWithLiveStatus.filter(r => r.status === 'not_ready')
  const blockedRows = rowsWithLiveStatus.filter(r => r.status === 'blocked')

  async function handleRemove(row: ReviewRow) {
    setRemovingId(row.contactId)
    try {
      if (row.campaignContactId && campaign) {
        const res = await fetch(`/api/admin/outbound/campaigns/${campaign.id}/contacts/${row.contactId}`, { method: 'DELETE' })
        const data = await res.json()
        if (!data.success) {
          toast.error(data.error ?? 'Could not remove this contact')
          return
        }
      }
      onExcludedIdsChange(new Set(excludedIds).add(row.contactId))
      toast.success(`Removed ${row.personName} from this send`)
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setRemovingId(null)
    }
  }

  async function openPreview(row: ReviewRow) {
    setPreview({ personName: row.personName, subject: '', body: '', loading: true, notFound: false })
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${row.contactId}/generated-content`)
      const data = await res.json()
      const generated = data.success ? data.generated : null
      const body = generated?.email_draft?.fullText as string | undefined
      if (!generated?.selected_subject_line || !body) {
        setPreview(p => (p ? { ...p, loading: false, notFound: true } : p))
        return
      }
      setPreview({ personName: row.personName, subject: generated.selected_subject_line, body, loading: false, notFound: false })
    } catch {
      setPreview(p => (p ? { ...p, loading: false, notFound: true } : p))
    }
  }

  async function handleConfirmSend() {
    await sendSelectedContacts(readyRows.map(r => r.contactId))
    setPendingConfirm(false)
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Spinner className="size-4" /> Loading review…
      </div>
    )
  }

  if (!summary || summary.total === 0) {
    return <EmptyState icon={Mail} title="No contacts to review" description="Go back and add contacts first." />
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Review & Send
          <InfoTooltip>
            Nothing has been sent yet. Review who's ready, preview or remove anyone, then confirm.
          </InfoTooltip>
        </h2>
        <p className="text-xs text-muted-foreground/70 mt-0.5">{campaign?.name}</p>
        {qualification && <div className="mt-1.5"><CompactSectorBadge qualification={qualification} /></div>}
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">
            {readyRows.length} of {summary.total} message{summary.total === 1 ? '' : 's'} ready
          </p>
          <span className="text-xs text-muted-foreground/70">
            Sending from <span className="text-foreground font-medium">{isRealSendingProvider ? sendingProviderName : 'Demo mode (mock)'}</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip label="Ready to review" value={readyRows.length} tone="strong" />
          <StatChip label="Needs attention" value={missingEmailRows.length + notReadyRows.length + blockedRows.length} tone="medium" />
          <StatChip label="Suppressed" value={suppressedRows.length} tone="destructive" />
          <StatChip label="Already sent" value={alreadySentRows.length} />
        </div>
      </div>

      <div className="space-y-1.5">
        {[...readyRows, ...notReadyRows, ...blockedRows, ...missingEmailRows, ...suppressedRows, ...alreadySentRows].map(row => {
          const meta = STATUS_META[row.status]
          const isSendingThis = sendingContactId === row.contactId
          return (
            <div key={row.contactId} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3 transition-colors hover:border-border-strong">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground truncate">{row.personName}</span>
                  <IntelStatus status={meta.status} label={meta.label} />
                  {row.status === 'ready' && row.emailConfidence === 'low' && (
                    <Badge
                      variant="secondary"
                      className="text-[10px]"
                      title="This email was found with low confidence - consider double-checking it before sending."
                    >
                      Unverified email
                    </Badge>
                  )}
                  {row.status === 'ready' && (row.discoveryGroundingStatus === 'conflict' || row.discoveryGroundingStatus === 'not_found') && (
                    <Badge
                      variant={row.discoveryGroundingStatus === 'conflict' ? 'destructive' : 'outline'}
                      className="text-[10px]"
                      title={row.discoveryGroundingReason ?? undefined}
                    >
                      {row.discoveryGroundingStatus === 'conflict' ? 'Company conflict' : 'Not on company site'}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground/70 truncate">{row.email ?? row.reason ?? '-'}</p>
                {row.status !== 'ready' && row.reason && row.email && (
                  <p className="text-xs text-muted-foreground/60">{row.reason}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {row.status === 'ready' && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => void openPreview(row)}>Preview</Button>
                    <Button size="sm" variant="ghost" onClick={() => onEditContact(row.contactId)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSendingThis}
                      onClick={() => void sendOneContact(row.contactId)}
                    >
                      {isSendingThis ? <Spinner className="size-3.5" /> : null}
                      Send
                    </Button>
                  </>
                )}
                {(row.status === 'ready' || row.status === 'not_ready' || row.status === 'blocked') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={removingId === row.contactId}
                    className="text-muted-foreground/60 hover:text-destructive"
                    onClick={() => void handleRemove(row)}
                  >
                    {removingId === row.contactId ? <Spinner className="size-3.5" /> : null}
                    Remove
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {(groundingIssueCount > 0 || !!researchQualityFlagged) && (
        <div className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2 text-xs text-signal-medium space-y-0.5">
          {groundingIssueCount > 0 && (
            <p>
              {groundingIssueCount} contact{groundingIssueCount === 1 ? '' : 's'} ready to send could not be fully
              confirmed against this company's own website - review the "Company conflict" / "Not on company site"
              badge{groundingIssueCount === 1 ? '' : 's'} above before sending.
            </p>
          )}
          {!!researchQualityFlagged && (
            <p>
              {researchQualityFlagged} item{researchQualityFlagged === 1 ? '' : 's'} in this company's research were
              flagged for lower confidence - review the Research step before sending.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3.5">
        <p className="text-xs text-muted-foreground/70">
          {readyRows.length === 0
            ? 'Nothing ready to send yet.'
            : `${readyRows.length} email${readyRows.length === 1 ? '' : 's'} will be sent${isRealSendingProvider ? ' - this is a real send.' : ' (demo mode).'}`}
        </p>
        <Button size="lg" disabled={readyRows.length === 0 || sendingSelected} onClick={() => setPendingConfirm(true)}>
          {sendingSelected ? <Spinner className="size-3.5" /> : null}
          Send {readyRows.length} message{readyRows.length === 1 ? '' : 's'}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingConfirm}
        onOpenChange={open => { if (!open) setPendingConfirm(false) }}
        title="Send this campaign?"
        description={`You are about to send ${readyRows.length} email${readyRows.length === 1 ? '' : 's'} from ${isRealSendingProvider ? sendingProviderName : 'the demo (mock) sending account'}. Follow-ups will be scheduled according to this campaign's rules. Emails will stop automatically when configured stop conditions are met (a reply, a bounce, or suppression). ${isRealSendingProvider ? 'This is a REAL send - real emails will go out.' : 'Mock sending only, no real email goes out yet.'}${groundingIssueCount > 0 ? ` WARNING: ${groundingIssueCount} contact${groundingIssueCount === 1 ? '' : 's'} could not be fully confirmed against this company's own website.` : ''}`}
        confirmLabel="Confirm & Send"
        loading={sendingSelected}
        onConfirm={() => void handleConfirmSend()}
      />

      <AlertDialog open={preview !== null} onOpenChange={open => { if (!open) setPreview(null) }}>
        <AlertDialogPortal>
          <AlertDialogBackdrop />
          <AlertDialogPopup className="max-w-lg">
            <AlertDialogTitle>Preview: {preview?.personName}</AlertDialogTitle>
            <AlertDialogDescription>
              {preview?.loading ? 'Loading…' : preview?.notFound ? 'Message not ready — Demaze couldn’t create a message for this person yet.' : 'Read-only preview of the exact email that will be sent.'}
            </AlertDialogDescription>
            {preview && !preview.loading && !preview.notFound && (
              <div className="mt-3 space-y-2">
                <div className="text-xs text-muted-foreground/70">Subject: <span className="text-foreground font-medium">{humanizeText(preview.subject)}</span></div>
                <div className="rounded border border-input bg-muted/30 px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap max-h-72 overflow-y-auto">
                  {humanizeText(preview.body)}
                </div>
              </div>
            )}
            <div className="mt-5 flex justify-end">
              <AlertDialogClose className="group/button inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50">
                Close
              </AlertDialogClose>
            </div>
          </AlertDialogPopup>
        </AlertDialogPortal>
      </AlertDialog>
    </div>
  )
}

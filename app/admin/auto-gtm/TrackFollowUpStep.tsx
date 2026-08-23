'use client'

// ============================================================
// TrackFollowUpStep - Auto Flow's "Track & Follow Up" step (step 6)
// ============================================================
// Shows THIS company's contacts (the ones just sent to in step 4) with
// their real send/open/reply status and manual follow-up actions -
// continuing the flow past send instead of leaving it as a dead end. No new
// backend logic: reuses the same routes the standalone Follow-ups/Campaigns
// pages already use (POST .../send-now, .../stop, .../check-replies).
//
// Self-contained, same pattern as OutreachStep/ContactInfoStep - fetches
// and owns its own data rather than growing useAutoGtmFlow's central state.
//
// Scoping note: `campaignId` is not always dedicated to this one company -
// a batch-originated company shares ONE campaign with every other company
// in that batch (see useAutoGtmFlow.ts's resumeFromRun fix). This step
// filters the campaign's contacts down to just the ones in the `contacts`
// prop (already correctly scoped to this company) before rendering, rather
// than assuming every row in the campaign belongs here. The same scoping
// applies to the bulk "Send All Due" action below - it passes this
// company's contact_ids to process-followups so it never touches another
// company's contacts sharing the same campaign.
//
// Preview/edit-before-send (added after the initial build, closing the
// "clicking Send Follow-up Now fires blind" gap): clicking Send Follow-up
// Now no longer sends immediately - it opens a dialog showing the actual
// subject (computed, not editable - see followup-schedule.ts's
// buildFollowupSubject comment on why Gmail threading requires the
// original subject verbatim) and the drafted body (editable). An edited
// body is saved via the existing generated-content PATCH route (the same
// one OutreachStep.tsx's inline editor already uses) before send-now is
// called, so a saved edit persists even if the send itself is later retried.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { IntelStatus, type IntelStatusKind } from '@/components/ui/intel-status'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { InfoTooltip } from '@/components/ui/tooltip'
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
import { Clock, Mail, Eye, EyeOff } from 'lucide-react'
import { staggerList, listItem } from '@/lib/motion'
import { nextFollowupSequence, buildFollowupSubject } from '@/lib/outbound/sending/followup-schedule'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'
import type { OutboundIntegrationRow } from '@/lib/outbound/settings/types'
import { CampaignDashboard, type DashboardRow } from './CampaignDashboard'
import { ContactTimeline } from './ContactTimeline'
import type { CampaignEvent } from './EventLabels'

interface TrackedContact {
  id: string // outbound_campaign_contacts.id
  contact_id: string
  status: string
  updated_at: string
  opened_at: string | null
  nextFollowupDueAt: string | null
  provider_message_id: string | null
  suppression: { reason: string; detail: string | null } | null
  outbound_contacts: { person_name: string; email: string | null; company_name: string } | null
}

// Local shape, deliberately duplicated rather than imported - same
// duplication-over-sharing convention OutreachStep.tsx's own FollowupDraft/
// GeneratedContent interfaces already use. Only the fields this dialog
// actually reads are declared; the real row (outbound_generated_content)
// has more columns.
interface FollowupDraftRow {
  sequence: number
  body: string
}
interface GeneratedContentRow {
  selected_subject_line: string | null
  followups: FollowupDraftRow[] | null
}

interface PreviewState {
  row: TrackedContact
  sequence: number
  loading: boolean
  notFound: boolean
  subjectPreview: string
  allFollowups: FollowupDraftRow[]
  body: string
  originalBody: string
  sending: boolean
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(ms / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatDue(dueAt: string | null): string {
  if (!dueAt) return '-'
  const ms = new Date(dueAt).getTime() - Date.now()
  const days = Math.round(Math.abs(ms) / (24 * 60 * 60 * 1000))
  if (ms <= 0) return days === 0 ? 'Due today' : `Overdue by ${days}d`
  return days === 0 ? 'Due today' : `Due in ${days}d`
}

// Maps each real campaign-contact status onto IntelStatus's shared status
// vocabulary/dot color instead of an ad hoc colored Badge - same underlying
// status string, only the rendering primitive changed.
const STATUS_INTEL: Record<string, { status: IntelStatusKind; label: string }> = {
  queued: { status: 'not_researched', label: 'Not sent yet' },
  sent: { status: 'researching', label: 'Sent' },
  followup_1: { status: 'researching', label: 'Follow-up 1 sent' },
  followup_2: { status: 'researching', label: 'Follow-up 2 sent' },
  followup_3: { status: 'researching', label: 'Follow-up 3 sent' },
  replied: { status: 'complete', label: 'Replied' },
  bounced: { status: 'failed', label: 'Bounced' },
  stopped: { status: 'already_researched', label: 'Stopped' },
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_INTEL[status]
  if (!meta) return <Badge className="text-[10px] border border-border text-foreground">{status}</Badge>
  return <IntelStatus status={meta.status} label={meta.label} />
}

export function TrackFollowUpStep({
  campaignId,
  contacts,
}: {
  campaignId: string | null
  contacts: OutboundContact[]
}) {
  const [rows, setRows] = useState<TrackedContact[]>([])
  const [events, setEvents] = useState<CampaignEvent[]>([])
  const [expandedTimelineId, setExpandedTimelineId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyRowId, setBusyRowId] = useState<string | null>(null)
  const [checkingReplies, setCheckingReplies] = useState(false)
  const [pendingStop, setPendingStop] = useState<TrackedContact | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [pendingBulkSend, setPendingBulkSend] = useState(false)
  const [bulkSending, setBulkSending] = useState(false)
  const [sendingProviderName, setSendingProviderName] = useState<string | null>(null)
  // "Now," snapshotted once per rows load (see loadRows below) rather than
  // called inline inside the dueRows memo - see that memo's own comment.
  const [nowMs, setNowMs] = useState<number | null>(null)

  const loadRows = useCallback(async () => {
    if (!campaignId) {
      setRows([])
      setEvents([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const contactIds = new Set(contacts.map(c => c.id))
      const [contactsRes, eventsRes] = await Promise.all([
        fetch(`/api/admin/outbound/campaigns/${campaignId}/contacts`),
        fetch(`/api/admin/outbound/campaigns/${campaignId}/events`),
      ])
      const data = await contactsRes.json()
      const eventsData = await eventsRes.json()
      if (data.success) {
        setRows((data.contacts as TrackedContact[]).filter(cc => contactIds.has(cc.contact_id)))
        // Snapshotted alongside rows (not in a separate effect that would
        // just call setState synchronously on every rows change) - see the
        // comment on the dueRows memo below for why this can't be Date.now()
        // called directly inside that memo instead.
        setNowMs(Date.now())
      } else {
        toast.error(data.error ?? 'Failed to load tracking data')
      }
      // A campaign shared with other companies (batch mode) has events for
      // those other companies' contacts too - the dashboard/timeline below
      // only ever look up events by THIS company's own campaign_contact_id
      // values (present in `rows`), so unfiltered events are harmless here,
      // same scoping discipline this file's own header already documents
      // for the bulk "Send All Due" action.
      if (eventsData.success) setEvents(eventsData.events as CampaignEvent[])
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setLoading(false)
    }
  }, [campaignId, contacts])

  useEffect(() => {
    // Intentional fetch-on-mount/on-campaign-change, not a derived-state
    // anti-pattern - same precedent as this codebase's other self-fetching
    // step components (e.g. CompanyPipelineList.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows()
  }, [loadRows])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/outbound/integrations')
        const data = await res.json()
        if (!data.success) return
        const sendingRow = (data.integrations as OutboundIntegrationRow[]).find(
          row => row.capability === 'sending' && row.is_active
        )
        setSendingProviderName(sendingRow?.provider_name ?? 'mock')
      } catch {
        setSendingProviderName('mock')
      }
    })()
  }, [])

  const isRealSendingProvider = sendingProviderName !== null && sendingProviderName !== 'mock'

  const dashboardRows: DashboardRow[] = useMemo(
    () =>
      rows.map(r => ({
        id: r.id,
        contactId: r.contact_id,
        personName: r.outbound_contacts?.person_name ?? 'Unknown contact',
        email: r.outbound_contacts?.email ?? null,
        status: r.status,
        openedAt: r.opened_at,
        nextFollowupDueAt: r.nextFollowupDueAt,
        providerMessageId: r.provider_message_id,
        suppression: r.suppression,
      })),
    [rows]
  )

  // Contacts whose next follow-up is BOTH eligible and past the configured
  // cadence right now - the target set for "Send All Due". Deliberately
  // narrower than "eligible" (nextFollowupSequence !== null): a contact that's
  // eligible but not yet due should only be sent via the per-row preview
  // dialog (an explicit early/force send), never swept up by the bulk action.
  const dueRows = useMemo(
    () =>
      nowMs === null
        ? []
        : rows.filter(
            row =>
              nextFollowupSequence(row.status) !== null &&
              row.nextFollowupDueAt !== null &&
              new Date(row.nextFollowupDueAt).getTime() <= nowMs
          ),
    [rows, nowMs]
  )

  async function handleSendNow(row: TrackedContact) {
    setBusyRowId(row.id)
    try {
      const res = await fetch(`/api/admin/outbound/followups/${row.id}/send-now`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to send follow-up')
        return
      }
      const outcome = data.outcome?.status
      if (outcome === 'sent') toast.success('Follow-up sent')
      else if (outcome === 'cancelled_reply') toast.warning('Not sent - this contact already replied')
      else if (outcome === 'cancelled_bounce') toast.warning('Not sent - this address bounced')
      else toast.warning(data.outcome?.reason ?? `Could not send: ${outcome}`)
      await loadRows()
    } catch {
      toast.error('Could not reach the follow-up API')
    } finally {
      setBusyRowId(null)
    }
  }

  async function handleStop(row: TrackedContact) {
    setBusyRowId(row.id)
    try {
      const res = await fetch(`/api/admin/outbound/followups/${row.id}/stop`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to stop follow-ups')
        return
      }
      toast.success('Remaining follow-ups stopped')
      await loadRows()
    } catch {
      toast.error('Could not reach the follow-up API')
    } finally {
      setBusyRowId(null)
    }
  }

  async function openPreview(row: TrackedContact) {
    const sequence = nextFollowupSequence(row.status)
    if (sequence === null) return
    setPreview({
      row,
      sequence,
      loading: true,
      notFound: false,
      subjectPreview: '',
      allFollowups: [],
      body: '',
      originalBody: '',
      sending: false,
    })
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${row.contact_id}/generated-content`)
      const data = await res.json()
      const generated = data.success ? (data.generated as GeneratedContentRow | null) : null
      const draft = generated?.followups?.find(f => f.sequence === sequence)
      if (!generated?.selected_subject_line || !draft?.body) {
        setPreview(p => (p ? { ...p, loading: false, notFound: true } : p))
        return
      }
      setPreview(p =>
        p
          ? {
              ...p,
              loading: false,
              notFound: false,
              subjectPreview: buildFollowupSubject(generated.selected_subject_line as string),
              allFollowups: generated.followups ?? [],
              body: draft.body,
              originalBody: draft.body,
            }
          : p
      )
    } catch {
      toast.error('Could not load the drafted follow-up')
      setPreview(p => (p ? { ...p, loading: false, notFound: true } : p))
    }
  }

  async function confirmSendPreview() {
    if (!preview || preview.notFound) return
    setPreview(p => (p ? { ...p, sending: true } : p))
    try {
      if (preview.body !== preview.originalBody) {
        const updatedFollowups = preview.allFollowups.map(f =>
          f.sequence === preview.sequence ? { ...f, body: preview.body } : f
        )
        const patchRes = await fetch(`/api/admin/outbound/contacts/${preview.row.contact_id}/generated-content`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ followups: updatedFollowups }),
        })
        const patchData = await patchRes.json()
        if (!patchData.success) {
          toast.error(patchData.error ?? 'Failed to save your edits')
          setPreview(p => (p ? { ...p, sending: false } : p))
          return
        }
      }
      const row = preview.row
      setPreview(null)
      await handleSendNow(row)
    } catch {
      toast.error('Could not save your edits')
      setPreview(p => (p ? { ...p, sending: false } : p))
    }
  }

  async function handleSendAllDue() {
    if (!campaignId || dueRows.length === 0) return
    setBulkSending(true)
    try {
      const res = await fetch(`/api/admin/outbound/campaigns/${campaignId}/process-followups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: dueRows.map(r => r.contact_id) }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to process follow-ups')
        return
      }
      const parts = [`${data.sent ?? 0} sent`]
      if (data.cancelledByReply) parts.push(`${data.cancelledByReply} cancelled (replied)`)
      if (data.cancelledByBounce) parts.push(`${data.cancelledByBounce} cancelled (bounced)`)
      if (data.skipped) parts.push(`${data.skipped} skipped`)
      if (data.failed) parts.push(`${data.failed} failed`)
      toast.success(parts.join(', '))
      await loadRows()
    } catch {
      toast.error('Could not reach the follow-up API')
    } finally {
      setBulkSending(false)
    }
  }

  async function handleCheckReplies() {
    if (!campaignId) return
    setCheckingReplies(true)
    try {
      const res = await fetch(`/api/admin/outbound/campaigns/${campaignId}/check-replies`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to check replies')
        return
      }
      toast.success(
        data.message ?? `Checked ${data.checked ?? 0} - ${data.newReplies ?? 0} new repl${data.newReplies === 1 ? 'y' : 'ies'}, ${data.newBounces ?? 0} bounce(s)`
      )
      if (data.errors?.length) toast.warning(`${data.errors.length} error(s) while checking replies`)
      await loadRows()
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setCheckingReplies(false)
    }
  }

  // Not campaignId nullity anymore (a campaign row now exists eagerly from
  // the moment step 4's settings panel opens, see useAutoGtmFlow.ts's
  // 2026-08-12 restructure note) - "nothing sent yet" is now a real
  // question about whether any contact rows were ever enqueued, answered
  // once loading finishes rather than assumed from campaignId alone.
  if (!campaignId || (!loading && rows.length === 0)) {
    return (
      <EmptyState
        icon={Mail}
        title="Nothing sent yet"
        description="Send at least one email in Review & Send to start tracking status here."
      />
    )
  }

  return (
    <div className="space-y-4">
      {!loading && (
        <>
          <CampaignDashboard
            rows={dashboardRows}
            events={events}
            sendingProviderName={sendingProviderName}
          />
          <p className="text-xs text-muted-foreground/50">
            Click any card above to see the contacts behind it. Some recipient-side actions - the recipient
            blocking your address or marking the email as spam - aren&apos;t exposed by Gmail's API and aren&apos;t
            shown here; only what this app can actually observe (sent, open detected, replied, bounced) is.
          </p>
        </>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} contact{rows.length === 1 ? '' : 's'} in this send.
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={dueRows.length === 0 || bulkSending}
            onClick={() => setPendingBulkSend(true)}
          >
            {bulkSending ? <Spinner className="size-3.5" /> : null}
            Send All Due ({dueRows.length})
          </Button>
          <Button size="sm" variant="outline" disabled={checkingReplies} onClick={handleCheckReplies}>
            {checkingReplies ? <Spinner className="size-3.5" /> : null}
            Check for Replies
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Spinner className="size-4" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Mail} title="No contacts found for this send" />
      ) : (
        <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-2">
          {rows.map(row => {
            const eligible = nextFollowupSequence(row.status) !== null
            const busy = busyRowId === row.id
            return (
              <motion.div key={row.id} variants={listItem}>
                <Card className="border-border bg-card transition-colors hover:border-border-strong">
                  <CardContent className="px-5 py-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {row.outbound_contacts?.person_name ?? 'Unknown contact'}
                        </div>
                        <div className="text-xs text-muted-foreground/70 truncate">
                          {row.outbound_contacts?.email ?? 'no email on file'}
                        </div>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className={cn('flex items-center gap-1', row.opened_at && 'text-signal-strong')}>
                        {row.opened_at ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                        {row.opened_at ? `Open detected ${timeAgo(row.opened_at)}` : 'No open detected yet'}
                        <InfoTooltip>
                          Open detected means the recipient's email client loaded a tracking image - it doesn't
                          guarantee the message was read. Images may be blocked, or prefetched by the provider
                          before a human opens it.
                        </InfoTooltip>
                      </span>
                      {eligible && (
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          Next follow-up: {formatDue(row.nextFollowupDueAt)}
                        </span>
                      )}
                    </div>
                    {eligible && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void openPreview(row)}
                        >
                          {busy ? <Spinner className="size-3.5" /> : null}
                          Send Follow-up Now
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setPendingStop(row)}
                        >
                          Stop Remaining
                        </Button>
                      </div>
                    )}
                    <ContactTimeline
                      personName={row.outbound_contacts?.person_name ?? 'Unknown contact'}
                      events={events.filter(e => e.campaign_contact_id === row.id)}
                      open={expandedTimelineId === row.id}
                      onOpenChange={open => setExpandedTimelineId(open ? row.id : null)}
                    />
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      )}

      <ConfirmDialog
        open={pendingStop !== null}
        onOpenChange={open => { if (!open) setPendingStop(null) }}
        destructive
        title="Stop remaining follow-ups?"
        description={`No further follow-ups will be sent to ${pendingStop?.outbound_contacts?.person_name ?? 'this contact'}. This can't be undone from here.`}
        confirmLabel="Stop Follow-ups"
        loading={pendingStop ? busyRowId === pendingStop.id : false}
        onConfirm={() => {
          if (!pendingStop) return
          void handleStop(pendingStop).then(() => setPendingStop(null))
        }}
      />

      <ConfirmDialog
        open={pendingBulkSend}
        onOpenChange={open => { if (!open) setPendingBulkSend(false) }}
        title="Send all due follow-ups?"
        description={`Sends the next follow-up to ${dueRows.length} contact${dueRows.length === 1 ? '' : 's'} whose cadence is due right now. ${
          isRealSendingProvider
            ? `This is a REAL send via ${sendingProviderName} - real emails will go out.`
            : 'Mock sending only, no real email goes out yet.'
        }`}
        confirmLabel="Send All Due"
        loading={bulkSending}
        onConfirm={() => { void handleSendAllDue().then(() => setPendingBulkSend(false)) }}
      />

      {/* Preview/edit-before-send dialog - a wider custom popup (not
          ConfirmDialog, whose description is text-only) since this needs an
          editable textarea. Always mounted with open bound to `preview !==
          null` so base-ui's close transition can play, same convention as
          the ConfirmDialogs above. */}
      <AlertDialog open={preview !== null} onOpenChange={open => { if (!open && !preview?.sending) setPreview(null) }}>
        <AlertDialogPortal>
          <AlertDialogBackdrop />
          <AlertDialogPopup className="max-w-lg">
            <AlertDialogTitle>
              Follow-up {preview?.sequence ?? ''} to {preview?.row.outbound_contacts?.person_name ?? 'this contact'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {preview?.loading
                ? 'Loading the drafted follow-up…'
                : preview?.notFound
                  ? 'No follow-up content has been generated for this step yet - go to Outreach & Send to generate it first.'
                  : isRealSendingProvider
                    ? `This is a REAL send via ${sendingProviderName} - review before sending.`
                    : 'Mock sending only, no real email goes out yet.'}
            </AlertDialogDescription>

            {preview && !preview.loading && !preview.notFound && (
              <div className="mt-3 space-y-2">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground/70">
                    Subject <span className="text-muted-foreground/50">(fixed - required to keep this in the same email thread)</span>
                  </div>
                  <div className="w-full rounded border border-input bg-muted/40 px-2 py-1.5 text-xs text-foreground">
                    {preview.subjectPreview}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground/70" htmlFor="followup-preview-body">
                    Body
                  </label>
                  <textarea
                    id="followup-preview-body"
                    value={preview.body}
                    onChange={e => setPreview(p => (p ? { ...p, body: e.target.value } : p))}
                    rows={10}
                    disabled={preview.sending}
                    className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground whitespace-pre-wrap"
                  />
                </div>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <AlertDialogClose
                disabled={preview?.sending ?? false}
                className="group/button inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
              >
                Cancel
              </AlertDialogClose>
              <Button
                size="default"
                disabled={!preview || preview.loading || preview.notFound || preview.sending}
                onClick={() => void confirmSendPreview()}
              >
                {preview?.sending ? <Spinner className="size-3.5" /> : null}
                {preview && preview.body !== preview.originalBody ? 'Save & Send' : 'Send Now'}
              </Button>
            </div>
          </AlertDialogPopup>
        </AlertDialogPortal>
      </AlertDialog>
    </div>
  )
}

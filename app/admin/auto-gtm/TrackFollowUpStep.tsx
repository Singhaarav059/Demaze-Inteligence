'use client'

// ============================================================
// TrackFollowUpStep — Auto Flow's "Track & Follow Up" step (step 5)
// ============================================================
// Shows THIS company's contacts (the ones just sent to in step 4) with
// their real send/open/reply status and manual follow-up actions —
// continuing the flow past send instead of leaving it as a dead end. No new
// backend logic: reuses the same routes the standalone Follow-ups/Campaigns
// pages already use (POST .../send-now, .../stop, .../check-replies).
//
// Self-contained, same pattern as OutreachStep/ContactInfoStep — fetches
// and owns its own data rather than growing useAutoGtmFlow's central state.
//
// Scoping note: `campaignId` is not always dedicated to this one company —
// a batch-originated company shares ONE campaign with every other company
// in that batch (see useAutoGtmFlow.ts's resumeFromRun fix). This step
// filters the campaign's contacts down to just the ones in the `contacts`
// prop (already correctly scoped to this company) before rendering, rather
// than assuming every row in the campaign belongs here.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { Clock, Mail } from 'lucide-react'
import { staggerList, listItem } from '@/lib/motion'
import { nextFollowupSequence } from '@/lib/outbound/sending/followup-schedule'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'
import type { OutboundIntegrationRow } from '@/lib/outbound/settings/types'

interface TrackedContact {
  id: string // outbound_campaign_contacts.id
  contact_id: string
  status: string
  updated_at: string
  opened_at: string | null
  nextFollowupDueAt: string | null
  outbound_contacts: { person_name: string; email: string | null; company_name: string } | null
}

type PendingAction = { type: 'send' | 'stop'; row: TrackedContact } | null

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(ms / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatDue(dueAt: string | null): string {
  if (!dueAt) return '—'
  const ms = new Date(dueAt).getTime() - Date.now()
  const days = Math.round(Math.abs(ms) / (24 * 60 * 60 * 1000))
  if (ms <= 0) return days === 0 ? 'Due today' : `Overdue by ${days}d`
  return days === 0 ? 'Due today' : `Due in ${days}d`
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: 'bg-accent text-muted-foreground',
    sent: 'bg-primary/10 text-primary border border-primary/40',
    followup_1: 'bg-primary/10 text-primary border border-primary/40',
    followup_2: 'bg-primary/10 text-primary border border-primary/40',
    followup_3: 'bg-primary/10 text-primary border border-primary/40',
    replied: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30',
    bounced: 'bg-destructive/10 text-destructive border border-destructive/40',
    stopped: 'bg-accent text-muted-foreground',
  }
  const label: Record<string, string> = {
    queued: 'Not sent yet',
    sent: 'Sent',
    followup_1: 'Follow-up 1 sent',
    followup_2: 'Follow-up 2 sent',
    followup_3: 'Follow-up 3 sent',
    replied: 'Replied',
    bounced: 'Bounced',
    stopped: 'Stopped',
  }
  return <Badge className={`text-[10px] ${map[status] ?? 'border border-border text-foreground'}`}>{label[status] ?? status}</Badge>
}

export function TrackFollowUpStep({
  campaignId,
  contacts,
}: {
  campaignId: string | null
  contacts: OutboundContact[]
}) {
  const [rows, setRows] = useState<TrackedContact[]>([])
  const [loading, setLoading] = useState(true)
  const [busyRowId, setBusyRowId] = useState<string | null>(null)
  const [checkingReplies, setCheckingReplies] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [sendingProviderName, setSendingProviderName] = useState<string | null>(null)

  const loadRows = useCallback(async () => {
    if (!campaignId) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const contactIds = new Set(contacts.map(c => c.id))
      const res = await fetch(`/api/admin/outbound/campaigns/${campaignId}/contacts`)
      const data = await res.json()
      if (data.success) {
        setRows((data.contacts as TrackedContact[]).filter(cc => contactIds.has(cc.contact_id)))
      } else {
        toast.error(data.error ?? 'Failed to load tracking data')
      }
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setLoading(false)
    }
  }, [campaignId, contacts])

  useEffect(() => {
    // Intentional fetch-on-mount/on-campaign-change, not a derived-state
    // anti-pattern — same precedent as this codebase's other self-fetching
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
      else if (outcome === 'cancelled_reply') toast.warning('Not sent — this contact already replied')
      else if (outcome === 'cancelled_bounce') toast.warning('Not sent — this address bounced')
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
        data.message ?? `Checked ${data.checked ?? 0} — ${data.newReplies ?? 0} new repl${data.newReplies === 1 ? 'y' : 'ies'}, ${data.newBounces ?? 0} bounce(s)`
      )
      if (data.errors?.length) toast.warning(`${data.errors.length} error(s) while checking replies`)
      await loadRows()
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setCheckingReplies(false)
    }
  }

  if (!campaignId) {
    return (
      <EmptyState
        icon={Mail}
        title="Nothing sent yet"
        description="Send at least one email in Outreach & Send to start tracking status here."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} contact{rows.length === 1 ? '' : 's'} in this send.
        </p>
        <Button size="sm" variant="outline" disabled={checkingReplies} onClick={handleCheckReplies}>
          {checkingReplies ? <Spinner className="size-3.5" /> : null}
          Check for Replies
        </Button>
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
                <Card className="border-border bg-card">
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
                      <span>{row.opened_at ? `Opened ${timeAgo(row.opened_at)}` : 'Not opened yet'}</span>
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
                          onClick={() => setPendingAction({ type: 'send', row })}
                        >
                          {busy ? <Spinner className="size-3.5" /> : null}
                          Send Follow-up Now
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setPendingAction({ type: 'stop', row })}
                        >
                          Stop Remaining
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={open => { if (!open) setPendingAction(null) }}
        destructive={pendingAction?.type === 'stop'}
        title={pendingAction?.type === 'stop' ? 'Stop remaining follow-ups?' : 'Send this follow-up now?'}
        description={
          pendingAction?.type === 'stop'
            ? `No further follow-ups will be sent to ${pendingAction.row.outbound_contacts?.person_name ?? 'this contact'}. This can't be undone from here.`
            : `Sends the next follow-up to ${pendingAction?.row.outbound_contacts?.person_name ?? 'this contact'} right now, regardless of the cadence schedule. ${
                isRealSendingProvider
                  ? `This is a REAL send via ${sendingProviderName} — a real email will go out.`
                  : 'Mock sending only, no real email goes out yet.'
              }`
        }
        confirmLabel={pendingAction?.type === 'stop' ? 'Stop Follow-ups' : 'Send Now'}
        loading={pendingAction ? busyRowId === pendingAction.row.id : false}
        onConfirm={() => {
          if (!pendingAction) return
          const { type, row } = pendingAction
          if (type === 'stop') void handleStop(row).then(() => setPendingAction(null))
          else void handleSendNow(row).then(() => setPendingAction(null))
        }}
      />
    </div>
  )
}

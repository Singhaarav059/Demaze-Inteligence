'use client'

// ============================================================
// Follow-up Control Panel — /admin/outbound/followups
// ============================================================
// Session 2 of the "Outreach Control Center" build. Per-contact view of
// every campaign_contact still owed a follow-up: what's due and when,
// manual "Send Now" (bypasses the schedule) / "Stop Remaining" (cancels the
// rest of the sequence for that one contact) actions, inline editing of the
// next follow-up's copy before it goes out, and a global cadence editor
// (replacing the old hardcoded 3/4/7-day intervals).
//
// Send Now can trigger a REAL send once a real sending provider (e.g.
// Gmail) is active — same standing rule as Campaigns page's Send Queued/
// Process Follow-ups (CLAUDE.md's per-batch confirmation requirement), so
// it's gated behind the same ConfirmDialog + real-provider-aware copy.
// Stop Remaining isn't a send, but is a one-way door (no "resume" action),
// so it gets its own confirm too.
// ============================================================

import { useEffect, useState } from 'react'
import { Clock, Mail } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { GuideNote } from '@/components/ui/guide-note'
import { useFollowupPanel, type FollowupRow } from './useFollowupPanel'
import type { OutboundIntegrationRow } from '@/lib/outbound/settings/types'

type PendingAction = { type: 'send' | 'stop'; row: FollowupRow } | null

function formatDue(dueAt: string | null, overdue: boolean) {
  if (!dueAt) return null
  const ms = new Date(dueAt).getTime() - Date.now()
  const days = Math.round(Math.abs(ms) / (24 * 60 * 60 * 1000))
  if (overdue) return days === 0 ? 'Due today' : `Overdue by ${days}d`
  return days === 0 ? 'Due today' : `Due in ${days}d`
}

export default function FollowupPanelPage() {
  const {
    rows,
    intervals,
    loading,
    savingIntervals,
    busyRowId,
    savingDraftId,
    saveIntervals,
    sendNow,
    stopFollowups,
    saveDraft,
  } = useFollowupPanel()

  const [intervalDraft, setIntervalDraft] = useState<[number, number, number]>(intervals)
  const [editedBody, setEditedBody] = useState<Record<string, string>>({})
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [sendingProviderName, setSendingProviderName] = useState<string | null>(null)

  useEffect(() => setIntervalDraft(intervals), [intervals])

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

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Follow-ups</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          What follow-up is due for whom, send now / stop, and the follow-up cadence.
        </p>
      </div>

      <GuideNote>
        <p>
          Every contact still owed a follow-up, across every campaign, sorted by what&apos;s due
          soonest. <strong>Send Now</strong> bypasses the schedule; <strong>Stop Remaining</strong>{' '}
          cancels the rest of that contact&apos;s sequence and can&apos;t be undone from this page.
        </p>
      </GuideNote>

      <Card className="border-border bg-card">
        <CardContent className="px-5 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Follow-up Cadence</h2>
          <p className="text-xs text-muted-foreground/70">
            Days since the previous send before each step is due. Applies to every campaign.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {(['Step 1', 'Step 2', 'Step 3'] as const).map((label, i) => (
              <div key={label} className="space-y-1">
                <Label htmlFor={`interval-${i}`}>{label} (days)</Label>
                <Input
                  id={`interval-${i}`}
                  type="number"
                  min={1}
                  max={365}
                  value={intervalDraft[i]}
                  onChange={e => {
                    const next: [number, number, number] = [...intervalDraft]
                    next[i] = Number(e.target.value) || 1
                    setIntervalDraft(next)
                  }}
                />
              </div>
            ))}
          </div>
          <Button
            size="sm"
            disabled={savingIntervals || intervalDraft.every((v, i) => v === intervals[i])}
            onClick={() => saveIntervals(intervalDraft)}
          >
            {savingIntervals ? <Spinner className="size-3.5" /> : null}
            Save Cadence
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Spinner className="size-4" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Mail} title="No contacts currently owed a follow-up" />
      ) : (
        <div className="space-y-3">
          {rows.map(row => {
            const dueLabel = formatDue(row.dueAt, row.overdue)
            const bodyValue = editedBody[row.id] ?? row.draftBody ?? ''
            const bodyDirty = editedBody[row.id] !== undefined && editedBody[row.id] !== (row.draftBody ?? '')
            const busy = busyRowId === row.id

            return (
              <Card key={row.id} className="border-border bg-card">
                <CardContent className="px-5 py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">{row.personName}</div>
                      <div className="text-xs text-muted-foreground/70">
                        {row.companyName}
                        {row.email ? ` · ${row.email}` : ' · no email on file'}
                      </div>
                      <div className="text-xs text-muted-foreground/60 mt-0.5">
                        {row.campaignName}
                        {row.campaignPaused && <Badge variant="secondary" className="ml-1.5">campaign paused</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline">Step {row.sequence}</Badge>
                      {dueLabel && (
                        <span className={row.overdue ? 'text-xs font-medium text-destructive flex items-center gap-1' : 'text-xs text-muted-foreground/70 flex items-center gap-1'}>
                          <Clock className="size-3" />
                          {dueLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  {row.draftSubject && (
                    <div className="text-xs text-muted-foreground">
                      <span className="text-muted-foreground/60">Subject: </span>
                      {row.draftSubject}
                    </div>
                  )}

                  {row.draftBody === null ? (
                    <p className="text-xs text-muted-foreground/60 italic">
                      No generated follow-up copy yet for this step — generate it on the Contacts page first.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      <textarea
                        value={bodyValue}
                        onChange={e => setEditedBody(prev => ({ ...prev, [row.id]: e.target.value }))}
                        rows={4}
                        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                      />
                      {bodyDirty && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={savingDraftId === row.id}
                          onClick={async () => {
                            await saveDraft(row, bodyValue)
                            setEditedBody(prev => {
                              const next = { ...prev }
                              delete next[row.id]
                              return next
                            })
                          }}
                        >
                          {savingDraftId === row.id ? <Spinner className="size-3.5" /> : null}
                          Save Copy
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={busy || !row.email || row.draftBody === null || row.campaignPaused}
                      onClick={() => setPendingAction({ type: 'send', row })}
                    >
                      {busy ? <Spinner className="size-3.5" /> : null}
                      Send Now
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setPendingAction({ type: 'stop', row })}
                    >
                      Stop Remaining Follow-ups
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={open => { if (!open) setPendingAction(null) }}
        destructive={pendingAction?.type === 'stop'}
        title={pendingAction?.type === 'stop' ? 'Stop remaining follow-ups?' : 'Send this follow-up now?'}
        description={
          pendingAction?.type === 'stop'
            ? `No further follow-ups will be sent to ${pendingAction.row.personName}. This can't be undone from this page.`
            : `Sends Step ${pendingAction?.row.sequence} to ${pendingAction?.row.personName} right now, regardless of the cadence schedule. ${
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
          if (type === 'stop') void stopFollowups(row.id).then(() => setPendingAction(null))
          else void sendNow(row.id).then(() => setPendingAction(null))
        }}
      />
    </div>
  )
}

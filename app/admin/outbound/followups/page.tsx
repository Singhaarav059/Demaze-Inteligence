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

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
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
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { fadeSlideUp, staggerList, listItem } from '@/lib/motion'
import type { FollowupEngineTickSummary } from '@/lib/outbound/sending/followup-engine/run-tick'
import { useFollowupPanel, type FollowupRow } from './useFollowupPanel'
import type { OutboundIntegrationRow } from '@/lib/outbound/settings/types'
import { StatusDot } from '../StatusDot'

type PendingAction = { type: 'send' | 'stop'; row: FollowupRow } | null

interface CompanyGroup {
  companyName: string
  rows: FollowupRow[]
  overdueCount: number
  earliestDueMs: number
}

function formatDue(dueAt: string | null, overdue: boolean) {
  if (!dueAt) return null
  const ms = new Date(dueAt).getTime() - Date.now()
  const days = Math.round(Math.abs(ms) / (24 * 60 * 60 * 1000))
  if (overdue) return days === 0 ? 'Due today' : `Overdue by ${days}d`
  return days === 0 ? 'Due today' : `Due in ${days}d`
}

// Groups the flat, due-soonest-sorted row list into one folder per company —
// requested directly (2026-08-04): with multiple contacts across several
// companies all owed follow-ups, the flat list made it hard to see "what's
// outstanding for company X" without scanning every row. Groups themselves
// stay sorted by their most urgent row (overdue groups first, then soonest
// due) so the page still answers "what needs attention first" at a glance
// even collapsed — the same promise the old flat list's sort order made.
// Row order within a group is preserved exactly as the API returned it.
function groupByCompany(rows: FollowupRow[]): CompanyGroup[] {
  const byCompany = new Map<string, FollowupRow[]>()
  for (const row of rows) {
    const key = row.companyName || 'Unknown company'
    const existing = byCompany.get(key)
    if (existing) existing.push(row)
    else byCompany.set(key, [row])
  }

  const groups: CompanyGroup[] = Array.from(byCompany.entries()).map(([companyName, groupRows]) => {
    const overdueCount = groupRows.filter(r => r.overdue).length
    const earliestDueMs = groupRows.reduce((min, r) => {
      if (!r.dueAt) return min
      const ms = new Date(r.dueAt).getTime()
      return ms < min ? ms : min
    }, Infinity)
    return { companyName, rows: groupRows, overdueCount, earliestDueMs }
  })

  groups.sort((a, b) => {
    if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount
    return a.earliestDueMs - b.earliestDueMs
  })

  return groups
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
  const [runningEngineTick, setRunningEngineTick] = useState(false)
  const [engineTickSummary, setEngineTickSummary] = useState<FollowupEngineTickSummary | null>(null)
  // Collapsed by default — "folder" you open, not a pre-expanded list; see
  // groupByCompany()'s header comment for why.
  const [openCompanies, setOpenCompanies] = useState<Set<string>>(new Set())

  const companyGroups = useMemo(() => groupByCompany(rows), [rows])

  function toggleCompany(companyName: string) {
    setOpenCompanies(prev => {
      const next = new Set(prev)
      if (next.has(companyName)) next.delete(companyName)
      else next.add(companyName)
      return next
    })
  }

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

  async function handleRunEngineTick() {
    setRunningEngineTick(true)
    try {
      const res = await fetch('/api/admin/outbound/followups/engine/tick', { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Follow-up engine tick failed')
        return
      }
      setEngineTickSummary(data.summary)
      toast.success(
        `Tick complete — ${data.summary.sent} sent, ${data.summary.contactsEligible} eligible, ${data.summary.cancelledByReply} cancelled by reply`
      )
      if (data.summary.errors?.length) toast.warning(`${data.summary.errors.length} error(s) during tick — see summary below`)
    } catch {
      toast.error('Could not reach the follow-up engine API')
    } finally {
      setRunningEngineTick(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Follow-ups</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          What follow-up is due for whom, send now / stop, and the follow-up cadence.
        </p>
      </div>

      <motion.div variants={fadeSlideUp} initial="hidden" animate="visible" className="space-y-6">
      <GuideNote>
        <p>
          Every contact still owed a follow-up, across every campaign, sorted by what&apos;s due
          soonest. <strong>Send Now</strong> bypasses the schedule; <strong>Stop Remaining</strong>{' '}
          cancels the rest of that contact&apos;s sequence and can&apos;t be undone from this page.
        </p>
      </GuideNote>

      <CollapsibleRow
        summary={
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Follow-up Settings</h2>
            <span className="text-xs text-muted-foreground/70 shrink-0">
              Cadence: {intervals.join(' / ')} days
            </span>
          </div>
        }
      >
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-foreground">Follow-up Cadence</h3>
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
          </div>

          <div className="space-y-3 pt-3 border-t border-border">
            <h3 className="text-xs font-medium text-foreground">Automatic Follow-Up Engine</h3>
            <p className="text-xs text-muted-foreground/70">
              When enabled, checks replies then auto-sends any follow-up that&apos;s past the cadence above{' '}
              <strong>and</strong> confirmed unopened — no click needed. Run a tick manually here to verify it behaves
              correctly before turning on the autonomous scheduler (<code>FOLLOWUP_ENGINE_ENABLED</code>).
            </p>
            <Button size="sm" variant="outline" disabled={runningEngineTick} onClick={handleRunEngineTick}>
              {runningEngineTick ? <Spinner className="size-3.5" /> : null}
              Run Follow-Up Engine Tick Now
            </Button>
            {engineTickSummary && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1 sm:grid-cols-3">
                <span>Campaigns checked: <span className="text-foreground">{engineTickSummary.campaignsChecked}</span></span>
                <span>Eligible: <span className="text-foreground">{engineTickSummary.contactsEligible}</span></span>
                <span>Sent: <span className="text-foreground">{engineTickSummary.sent}</span></span>
                <span>Cancelled (reply): <span className="text-foreground">{engineTickSummary.cancelledByReply}</span></span>
                <span>Cancelled (bounce): <span className="text-foreground">{engineTickSummary.cancelledByBounce}</span></span>
                <span>Failed: <span className="text-foreground">{engineTickSummary.failed}</span></span>
                <span>Ambiguous: <span className="text-foreground">{engineTickSummary.ambiguous}</span></span>
                {engineTickSummary.errors.length > 0 && (
                  <div className="col-span-full text-signal-medium mt-1">
                    {engineTickSummary.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
      </CollapsibleRow>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Spinner className="size-4" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Mail} title="No contacts currently owed a follow-up" />
      ) : (
        <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-2">
          {companyGroups.map(group => {
            const isOpen = openCompanies.has(group.companyName)
            return (
              <motion.div key={group.companyName} variants={listItem}>
                <CollapsibleRow
                  open={isOpen}
                  onOpenChange={() => toggleCompany(group.companyName)}
                  summary={
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{group.companyName}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-3">
                        {group.overdueCount > 0 && (
                          <StatusDot tone="destructive" label={`${group.overdueCount} overdue`} />
                        )}
                        <span className="text-xs text-muted-foreground/70">
                          {group.rows.length} follow-up{group.rows.length === 1 ? '' : 's'}
                        </span>
                      </span>
                    </div>
                  }
                >
                  <div className="space-y-3">
                  {group.rows.map(row => {
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
                                {row.email ?? 'no email on file'}
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
                </CollapsibleRow>
              </motion.div>
            )
          })}
        </motion.div>
      )}
      </motion.div>

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

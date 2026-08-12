'use client'

// ============================================================
// CampaignDashboard — actionable stat cards (step 6, "Track & Follow Up")
// ============================================================
// Per explicit user feedback: this must NOT be just a row of counts.
// Clicking any card immediately reveals the underlying contacts for that
// segment, with segment-specific detail pulled from data this app already
// records — a reply timestamp + thread link, the actual bounce reason, who
// a follow-up is scheduled for and when, why a sequence stopped, the real
// suppression reason. No new data source: everything here comes from the
// campaign_contacts rows and campaign_events already fetched by
// TrackFollowUpStep.tsx and passed down as props.
// ============================================================

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { BarChart3 } from 'lucide-react'
import { nextFollowupSequence } from '@/lib/outbound/sending/followup-schedule'
import { formatTimestamp, type CampaignEvent } from './EventLabels'

export interface DashboardRow {
  id: string // campaign_contact id
  contactId: string
  personName: string
  email: string | null
  status: string
  openedAt: string | null
  nextFollowupDueAt: string | null
  providerMessageId: string | null
  suppression: { reason: string; detail: string | null } | null
}

type Segment = 'total' | 'queued' | 'sent' | 'opened' | 'replied' | 'bounced' | 'followups_scheduled' | 'stopped' | 'suppressed'

const SENT_STATUSES = ['sent', 'followup_1', 'followup_2', 'followup_3', 'replied', 'bounced', 'stopped']

function latestEvent(events: CampaignEvent[], campaignContactId: string, eventType: string): CampaignEvent | null {
  const matches = events.filter(e => e.campaign_contact_id === campaignContactId && e.event_type === eventType)
  if (matches.length === 0) return null
  return matches.reduce((latest, e) => (e.occurred_at > latest.occurred_at ? e : latest))
}

function formatDue(dueAt: string): string {
  const ms = new Date(dueAt).getTime() - Date.now()
  const days = Math.round(Math.abs(ms) / (24 * 60 * 60 * 1000))
  if (ms <= 0) return days === 0 ? 'due today' : `overdue by ${days}d`
  return days === 0 ? 'due today' : `due in ${days}d`
}

export function CampaignDashboard({
  rows,
  events,
  sendingProviderName,
}: {
  rows: DashboardRow[]
  events: CampaignEvent[]
  sendingProviderName: string | null
}) {
  const [selected, setSelected] = useState<Segment | null>(null)

  const buckets = useMemo(() => {
    return {
      total: rows,
      queued: rows.filter(r => r.status === 'queued'),
      sent: rows.filter(r => SENT_STATUSES.includes(r.status)),
      opened: rows.filter(r => r.openedAt !== null),
      replied: rows.filter(r => r.status === 'replied'),
      bounced: rows.filter(r => r.status === 'bounced'),
      followups_scheduled: rows.filter(r => nextFollowupSequence(r.status) !== null && r.nextFollowupDueAt !== null),
      stopped: rows.filter(r => r.status === 'stopped'),
      suppressed: rows.filter(r => r.suppression !== null),
    } satisfies Record<Segment, DashboardRow[]>
  }, [rows])

  const cards: Array<{ key: Segment; label: string; tooltip?: string }> = [
    { key: 'total', label: 'Total' },
    { key: 'queued', label: 'Queued' },
    { key: 'sent', label: 'Sent' },
    { key: 'opened', label: 'Opened', tooltip: 'Open detected via a tracking image — not a guarantee the message was read. Images may be blocked, or prefetched by the provider before a human opens it.' },
    { key: 'replied', label: 'Replied' },
    { key: 'bounced', label: 'Bounced', tooltip: "Gmail's bounce detection doesn't distinguish hard vs. soft bounces — every bounce is treated the same way and the address is suppressed either way." },
    { key: 'followups_scheduled', label: 'Follow-ups scheduled' },
    { key: 'stopped', label: 'Stopped' },
    { key: 'suppressed', label: 'Suppressed' },
  ]

  const selectedRows = selected ? buckets[selected] : []

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Campaign status — select a card to see the contacts behind it" className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {cards.map(c => {
          const isActive = selected === c.key
          const count = buckets[c.key].length
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={isActive}
              disabled={count === 0}
              onClick={() => setSelected(prev => (prev === c.key ? null : c.key))}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                isActive ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent/50'
              } ${count === 0 ? 'opacity-50 cursor-default' : 'cursor-pointer'}`}
            >
              <span className="block text-[11px] text-muted-foreground/70">{c.label}</span>
              <span className="block text-lg font-semibold text-foreground tabular-nums">{count}</span>
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground">
              {cards.find(c => c.key === selected)?.label} ({selectedRows.length})
            </h3>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-muted-foreground/70 hover:text-foreground underline">
              Close
            </button>
          </div>

          {cards.find(c => c.key === selected)?.tooltip && (
            <p className="text-[11px] text-muted-foreground/60">{cards.find(c => c.key === selected)?.tooltip}</p>
          )}

          {selectedRows.length === 0 ? (
            <EmptyState icon={BarChart3} title="Nothing here" className="border-none py-3" />
          ) : (
            <ul className="space-y-1.5">
              {selectedRows.map(row => (
                <li key={row.id} className="flex items-start justify-between gap-3 text-xs border-t border-border/60 pt-1.5 first:border-t-0 first:pt-0">
                  <div className="min-w-0">
                    <span className="text-foreground font-medium">{row.personName}</span>
                    <span className="block text-muted-foreground/60 truncate">{row.email ?? 'no email on file'}</span>
                  </div>
                  <div className="shrink-0 text-right text-muted-foreground/70 max-w-[55%]">
                    {selected === 'sent' && (() => {
                      const e = latestEvent(events, row.id, 'sent')
                      return e ? formatTimestamp(e.occurred_at) : '—'
                    })()}
                    {selected === 'opened' && row.openedAt && formatTimestamp(row.openedAt)}
                    {selected === 'replied' && (() => {
                      const e = latestEvent(events, row.id, 'replied')
                      return (
                        <span className="flex flex-col items-end gap-0.5">
                          {e ? formatTimestamp(e.occurred_at) : '—'}
                          {sendingProviderName === 'gmail' && row.providerMessageId && (
                            <a
                              href={`https://mail.google.com/mail/u/0/#all/${row.providerMessageId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2 hover:text-foreground"
                            >
                              View thread
                            </a>
                          )}
                        </span>
                      )
                    })()}
                    {selected === 'bounced' && (() => {
                      const e = latestEvent(events, row.id, 'bounced')
                      const from = e?.detail?.fromHeader
                      return <span className="block max-w-[220px] truncate">{typeof from === 'string' && from ? from : 'Bounce detected'}</span>
                    })()}
                    {selected === 'followups_scheduled' && row.nextFollowupDueAt && (
                      <span>Step {nextFollowupSequence(row.status)} — {formatDue(row.nextFollowupDueAt)}</span>
                    )}
                    {selected === 'stopped' && (() => {
                      const e = latestEvent(events, row.id, 'followup_stopped')
                      const manual = e?.detail?.source === 'manual_admin_action'
                      return <span>{manual ? 'Manually stopped' : 'Stopped'}{e ? ` — ${formatTimestamp(e.occurred_at)}` : ''}</span>
                    })()}
                    {selected === 'suppressed' && row.suppression && (
                      <span className="block max-w-[220px] truncate">
                        {row.suppression.reason}{row.suppression.detail ? ` — ${row.suppression.detail}` : ''}
                      </span>
                    )}
                    {selected === 'queued' && (
                      <span>{row.email ? 'Ready, not yet sent' : 'No email on file'}</span>
                    )}
                    {selected === 'total' && <Badge variant="outline" className="text-[10px]">{row.status}</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

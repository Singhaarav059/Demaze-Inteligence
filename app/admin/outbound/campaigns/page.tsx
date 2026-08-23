'use client'

// ============================================================
// Outbound Campaigns — /admin/outbound/campaigns
// ============================================================
// Create a campaign -> enqueue contacts already added on the Contacts page
// -> Send (mock provider only — no real email is delivered). Sending
// requires each enqueued contact to already have a generated email
// (Contacts page's Generate panel); contacts missing one are skipped, not
// silently marked sent.
// ============================================================

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Inbox, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { GuideNote } from '@/components/ui/guide-note'
import { MetricTile } from '@/components/ui/metric-tile'
import { cn } from '@/lib/utils'
import { fadeSlideUp, staggerList, listItem } from '@/lib/motion'
import { useOutboundCampaigns, type Campaign } from './useOutboundCampaigns'
import type { OutboundIntegrationRow } from '@/lib/outbound/settings/types'
import { StatusDot, type StatusTone } from '../StatusDot'

// Both Send Queued and Process Follow-ups can trigger a REAL send once a
// real sending provider (e.g. Gmail) is active — see CLAUDE.md's standing
// rule that sending real email always requires explicit per-batch
// confirmation, and docs/DECISIONS.md's 2026-07-29 incident note on this
// exact page's sibling (OutreachStep.tsx, Auto Flow's merged Outreach &
// Send step) for why neither of these can be allowed to fire with a single
// unguarded click once that's true.
type PendingAction = 'send' | 'followups' | null

interface AvailableContact {
  id: string
  person_name: string
  company_name: string
  email: string | null
}

function campaignStatusTone(status: Campaign['status']): StatusTone {
  if (status === 'active') return 'strong'
  if (status === 'paused') return 'medium'
  if (status === 'completed') return 'muted'
  return 'muted'
}

function contactStatusTone(status: string): StatusTone {
  if (status === 'replied' || status === 'sent') return 'strong'
  if (status === 'bounced') return 'destructive'
  if (status.startsWith('followup')) return 'medium'
  if (status === 'queued' || status === 'stopped') return 'muted'
  return 'muted'
}

export default function OutboundCampaignsPage() {
  return (
    <Suspense fallback={null}>
      <OutboundCampaignsPageInner />
    </Suspense>
  )
}

function OutboundCampaignsPageInner() {
  // Lets the Overview page's unified email table link straight to the
  // campaign a given row belongs to (?campaign=<id>) instead of leaving the
  // admin to find it in the dropdown themselves. Only applied once, on
  // mount — doesn't fight the dropdown if the admin picks a different
  // campaign afterward.
  const searchParams = useSearchParams()
  const campaignFromUrl = searchParams.get('campaign')

  const {
    campaigns,
    loadingCampaigns,
    selectedCampaignId,
    setSelectedCampaignId,
    campaignContacts,
    events,
    creating,
    enqueuing,
    sending,
    pausingOrResuming,
    checkingReplies,
    processingFollowups,
    createCampaign,
    enqueueContacts,
    sendCampaign,
    pauseOrResume,
    checkReplies,
    processFollowups,
  } = useOutboundCampaigns()

  const [newCampaignName, setNewCampaignName] = useState('')
  const [availableContacts, setAvailableContacts] = useState<AvailableContact[]>([])
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set())
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  // null while loading = treated as mock, same safe-default convention as
  // OutreachStep.tsx's identical state (don't imply "real" before the
  // active provider is actually confirmed).
  const [sendingProviderName, setSendingProviderName] = useState<string | null>(null)

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId) ?? null
  const isRealSendingProvider = sendingProviderName !== null && sendingProviderName !== 'mock'

  // Real counts derived from the selected campaign's already-fetched
  // contacts — per-campaign send/reply counts aren't returned by the
  // campaigns list endpoint itself (would need one extra fetch per
  // campaign to show on every card), so the campaign list below only ever
  // shows what it actually has (name/status/provider/created date); real
  // contact/sent/replied/bounced counts appear once a campaign is opened.
  const selectedCounts = useMemo(() => {
    let sent = 0, replied = 0, bounced = 0, queued = 0
    for (const cc of campaignContacts) {
      if (cc.status === 'replied') replied++
      else if (cc.status === 'bounced') bounced++
      else if (cc.status === 'queued') queued++
      else sent++
    }
    return { total: campaignContacts.length, sent, replied, bounced, queued }
  }, [campaignContacts])

  useEffect(() => {
    if (campaignFromUrl) setSelectedCampaignId(campaignFromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignFromUrl])

  const loadAvailableContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/outbound/contacts')
      const data = await res.json()
      if (data.success) setAvailableContacts(data.contacts)
    } catch {
      // non-fatal — the enqueue picker just stays empty
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  useEffect(() => {
    // Intentional fetch-on-mount, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAvailableContacts()
  }, [loadAvailableContacts])

  async function handleCreate() {
    if (!newCampaignName.trim()) return
    await createCampaign(newCampaignName.trim())
    setNewCampaignName('')
  }

  async function handleEnqueue() {
    if (selectedContactIds.size === 0) return
    await enqueueContacts(Array.from(selectedContactIds))
    setSelectedContactIds(new Set())
  }

  const alreadyEnqueuedIds = new Set(campaignContacts.map(cc => cc.contact_id))
  const enqueueableContacts = availableContacts.filter(c => !alreadyEnqueuedIds.has(c.id))

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Campaigns</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Batches of prepared emails, sent together to a group of contacts.
        </p>
      </div>

      <motion.div variants={fadeSlideUp} initial="hidden" animate="visible" className="space-y-6">
      <GuideNote>
        <p>
          This is the manual/debug version of sending — most of the time you&apos;ll create and send a
          campaign from Auto Flow instead, right after preparing outreach. Come here to inspect a
          queue, pause/resume, or trigger a send by hand.
        </p>
        <p>
          {isRealSendingProvider ? (
            <>
              <strong>Live sending:</strong> the active provider is <strong>{sendingProviderName}</strong>{' '}
              — real email goes out from here, gated by the confirmation dialog on every send.
            </>
          ) : (
            <>
              <strong>Test/demo mode:</strong> no real email is delivered here yet. Sending is built
              to go straight through your own connected Gmail account (OAuth, no per-email vendor
              fee, no Smartlead/Instantly needed) — connect it in{' '}
              <a href="/admin/outbound/integrations" className="underline underline-offset-2 hover:text-foreground">
                Integrations
              </a>{' '}
              to switch this page over from mock to live.
            </>
          )}
        </p>
      </GuideNote>

      <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-1">
        <Label htmlFor="new-campaign-name">New campaign</Label>
        <div className="flex gap-2">
          <Input
            id="new-campaign-name"
            aria-label="Campaign name"
            value={newCampaignName}
            onChange={e => setNewCampaignName(e.target.value)}
            placeholder="Q3 Manufacturing Outreach"
          />
          <Button size="sm" disabled={creating || !newCampaignName.trim()} onClick={handleCreate}>
            {creating ? <Spinner className="size-3.5" /> : null}
            Create
          </Button>
        </div>
      </div>

      {loadingCampaigns ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Spinner className="size-4" /> Loading campaigns…
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState icon={Inbox} title="No campaigns yet" className="border-none py-4" />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {campaigns.map(c => {
            const active = c.id === selectedCampaignId
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCampaignId(c.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors',
                  active ? 'bg-accent/60' : 'hover:bg-accent/40'
                )}
              >
                {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{c.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground/60">
                    {c.sender_provider} · {new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                <StatusDot tone={campaignStatusTone(c.status)} label={c.status} className="shrink-0" />
              </button>
            )
          })}
        </div>
      )}

      {selectedCampaign && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile icon={Inbox} label="Contacts" value={selectedCounts.total} />
            <MetricTile icon={Clock} label="Queued" value={selectedCounts.queued} />
            <MetricTile icon={Inbox} label="Sent" value={selectedCounts.sent} />
            <MetricTile icon={Inbox} label="Replied" value={selectedCounts.replied} sub={selectedCounts.bounced > 0 ? `${selectedCounts.bounced} bounced` : undefined} />
          </div>

          <Card className="border-border bg-card">
            <CardContent className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">{selectedCampaign.name}</h2>
                <StatusDot tone={campaignStatusTone(selectedCampaign.status)} label={selectedCampaign.status} />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={sending || campaignContacts.length === 0}
                  onClick={() => setPendingAction('send')}
                >
                  {sending ? <Spinner className="size-3.5" /> : null}
                  Send Queued
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pausingOrResuming || selectedCampaign.status === 'paused'}
                  onClick={() => pauseOrResume('pause')}
                >
                  Pause
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pausingOrResuming || selectedCampaign.status !== 'paused'}
                  onClick={() => pauseOrResume('resume')}
                >
                  Resume
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={checkingReplies || campaignContacts.length === 0}
                  onClick={checkReplies}
                >
                  {checkingReplies ? <Spinner className="size-3.5" /> : null}
                  Check for Replies
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={processingFollowups || campaignContacts.length === 0 || selectedCampaign.status === 'paused'}
                  onClick={() => setPendingAction('followups')}
                >
                  {processingFollowups ? <Spinner className="size-3.5" /> : null}
                  Process Follow-ups
                </Button>
              </div>
              <p className="text-xs text-muted-foreground/60">
                Free, on-demand only — this checks Gmail threads when you click it, not
                automatically. Only works while Gmail is the active sending provider.
              </p>
              <p className="text-xs text-muted-foreground/60">
                Process Follow-ups sends whichever follow-up in each contact&apos;s sequence
                is due (3/4/7 days apart) and skips anyone who already replied — also
                on-demand, click it rather than waiting for a timer.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="px-5 py-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Add Contacts</h3>
              {enqueueableContacts.length === 0 ? (
                <p className="text-xs text-muted-foreground/70">
                  No more contacts available. Add contacts on the Contacts page first.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {enqueueableContacts.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedContactIds.has(c.id)}
                        onChange={e =>
                          setSelectedContactIds(prev => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(c.id)
                            else next.delete(c.id)
                            return next
                          })
                        }
                      />
                      <span className="text-foreground">{c.person_name}</span>
                      <span className="text-muted-foreground/60">{c.company_name}</span>
                      {!c.email && <Badge variant="outline">no email</Badge>}
                    </label>
                  ))}
                </div>
              )}
              <Button size="sm" variant="outline" disabled={enqueuing || selectedContactIds.size === 0} onClick={handleEnqueue}>
                {enqueuing ? <Spinner className="size-3.5" /> : null}
                Add Selected to Campaign
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="px-5 py-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Queue</h3>
              {campaignContacts.length === 0 ? (
                <EmptyState icon={Inbox} title="No contacts enqueued yet" className="border-none py-4" />
              ) : (
                <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-1.5">
                  {campaignContacts.map(cc => (
                    <motion.div key={cc.id} variants={listItem} className="flex items-center justify-between text-xs">
                      <span className="text-foreground">
                        {cc.outbound_contacts?.person_name ?? cc.contact_id} · {cc.outbound_contacts?.company_name}
                      </span>
                      <StatusDot tone={contactStatusTone(cc.status)} label={cc.status.replace(/_/g, ' ')} />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="px-5 py-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Event Timeline</h3>
              {events.length === 0 ? (
                <EmptyState icon={Clock} title="No events yet" className="border-none py-4" />
              ) : (
                <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-1.5">
                  {events.map(e => (
                    <motion.div key={e.id} variants={listItem} className="flex items-center justify-between text-xs">
                      <Badge variant="outline">{e.event_type}</Badge>
                      <span className="text-muted-foreground/60">{new Date(e.occurred_at).toLocaleString()}</span>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      </motion.div>

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={open => { if (!open) setPendingAction(null) }}
        title={pendingAction === 'followups' ? 'Process due follow-ups?' : 'Send queued emails?'}
        description={
          pendingAction === 'followups'
            ? `Sends whichever follow-up is due for each contact in this campaign and cancels any whose thread already has a reply. ${
                isRealSendingProvider
                  ? `This is a REAL send via ${sendingProviderName} — real emails will go out.`
                  : 'Mock sending only, no real email goes out yet.'
              }`
            : `Sends the drafted email to every queued contact in this campaign. ${
                isRealSendingProvider
                  ? `This is a REAL send via ${sendingProviderName} — real emails will go out.`
                  : 'Mock sending only, no real email goes out yet.'
              }`
        }
        confirmLabel={pendingAction === 'followups' ? 'Process Follow-ups' : 'Send Queued'}
        loading={pendingAction === 'followups' ? processingFollowups : sending}
        onConfirm={() => {
          if (pendingAction === 'followups') {
            void processFollowups().then(() => setPendingAction(null))
          } else if (pendingAction === 'send') {
            void sendCampaign().then(() => setPendingAction(null))
          }
        }}
      />
    </div>
  )
}

'use client'

// ============================================================
// Email Warm-Up — /admin/outbound/warmup
// ============================================================
// Two kinds of mailbox card now (2026-08-04, real warmup engine):
//   - Manual (typed address, no OAuth) — unchanged from before: mock-
//     computed health from elapsed time since started_at, not a real test.
//   - OAuth Connected (via "Connect a Gmail mailbox") — a real pool member.
//     lib/outbound/warmup/engine/run-tick.ts actually sends/opens/spam-
//     rescues/replies between connected mailboxes and writes real metrics;
//     this page just reads what the engine already recorded, plus a
//     "Run Tick Now" button that calls the engine on demand (works whether
//     or not the autonomous scheduler is enabled — see instrumentation.ts).
// ============================================================

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Flame, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/glass-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/ui/empty-state'
import { GuideNote } from '@/components/ui/guide-note'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { fadeSlideUp, staggerList, listItem } from '@/lib/motion'

interface LiveStatus {
  status: 'not_started' | 'warming' | 'warmed' | 'paused'
  emailsSentTotal: number
  inboxRate: number
  spamRate: number
  domainHealthScore: number
}

interface Mailbox {
  id: string
  mailbox_address: string
  provider_name: string
  status: LiveStatus['status']
  started_at: string | null
  oauth_connected: boolean
  // Was OAuth-connected once, then disconnected via the Disconnect button
  // — distinct from a plain manual/mock-only entry that was never real.
  disconnected: boolean
  live_status: LiveStatus | null
}

interface ExchangeActivity {
  id: string
  direction: 'sent' | 'received'
  otherAddress: string
  subject: string
  sentAt: string
  status: 'sent' | 'processed' | 'failed'
  landedInSpam: boolean | null
  rescuedFromSpam: boolean
  replied: boolean
}

function WarmupStatusBadge({ status }: { status: LiveStatus['status'] }) {
  const map: Record<LiveStatus['status'], string> = {
    not_started: 'bg-accent text-muted-foreground',
    warming: 'bg-primary/10 text-primary border border-primary/40',
    warmed: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30',
    paused: 'bg-signal-medium/10 text-signal-medium border border-signal-medium/30',
  }
  return <Badge className={cn('shrink-0 text-[10px]', map[status])}>{status}</Badge>
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(ms / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function ActivityRow({ activity }: { activity: ExchangeActivity }) {
  const arrow = activity.direction === 'sent' ? '→' : '←'
  const bits: string[] = [timeAgo(activity.sentAt)]
  if (activity.status === 'sent') bits.push('pending')
  if (activity.status === 'failed') bits.push('failed')
  if (activity.rescuedFromSpam) bits.push('rescued from spam')
  else if (activity.landedInSpam) bits.push('landed in spam')
  if (activity.replied) bits.push('replied')

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground truncate">
        {arrow} {activity.otherAddress}
      </span>
      <span className="text-muted-foreground/70 shrink-0">{bits.join(' · ')}</span>
    </div>
  )
}

function MailboxCard({
  mailbox,
  onTick,
  ticking,
  onDisconnected,
}: {
  mailbox: Mailbox
  onTick: () => void
  ticking: boolean
  onDisconnected: () => void
}) {
  const [activityOpen, setActivityOpen] = useState(false)
  const [activity, setActivity] = useState<ExchangeActivity[] | null>(null)
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      const res = await fetch(`/api/admin/outbound/warmup/mailboxes/${mailbox.id}/disconnect`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to disconnect mailbox')
        return
      }
      toast.success(`Disconnected ${mailbox.mailbox_address} — warm-up history kept, reconnect any time`)
      setDisconnectOpen(false)
      onDisconnected()
    } catch {
      toast.error('Could not reach the warm-up API')
    } finally {
      setDisconnecting(false)
    }
  }

  async function toggleActivity() {
    if (activityOpen) {
      setActivityOpen(false)
      return
    }
    setActivityOpen(true)
    if (activity !== null) return
    setLoadingActivity(true)
    try {
      const res = await fetch(`/api/admin/outbound/warmup/mailboxes/${mailbox.id}/exchanges`)
      const data = await res.json()
      if (data.success) setActivity(data.exchanges)
      else toast.error(data.error ?? 'Failed to load recent activity')
    } catch {
      toast.error('Could not reach the warm-up API')
    } finally {
      setLoadingActivity(false)
    }
  }

  return (
    <CollapsibleRow
      summary={
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-foreground truncate">{mailbox.mailbox_address}</span>
            <Badge
              variant={mailbox.oauth_connected ? 'default' : mailbox.disconnected ? 'outline' : 'secondary'}
              className="shrink-0"
            >
              {mailbox.oauth_connected ? 'OAuth Connected' : mailbox.disconnected ? 'Disconnected' : 'Manual (mock only)'}
            </Badge>
            {mailbox.live_status && (
              <span className="text-xs text-muted-foreground/70 truncate hidden sm:inline">
                Inbox {Math.round(mailbox.live_status.inboxRate * 100)}% · Domain{' '}
                {mailbox.live_status.domainHealthScore}/100
              </span>
            )}
          </div>
          <WarmupStatusBadge status={mailbox.live_status?.status ?? mailbox.status} />
        </div>
      }
    >
        {mailbox.live_status ? (
          <>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground/70">Emails sent: </span>
                <span className="text-foreground">{mailbox.live_status.emailsSentTotal}</span>
              </div>
              <div>
                <span className="text-muted-foreground/70">Spam rate: </span>
                <span className="text-foreground">{Math.round(mailbox.live_status.spamRate * 100)}%</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground/70">Inbox rate</span>
                <span className="text-foreground">{Math.round(mailbox.live_status.inboxRate * 100)}%</span>
              </div>
              <Progress value={Math.round(mailbox.live_status.inboxRate * 100)} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground/70">Domain health</span>
                <span className="text-foreground">{mailbox.live_status.domainHealthScore}/100</span>
              </div>
              <Progress value={mailbox.live_status.domainHealthScore} />
            </div>
          </>
        ) : mailbox.oauth_connected ? (
          <p className="text-xs text-muted-foreground/60 italic">
            Connected, no real activity recorded yet — run a tick (needs at least 2 connected mailboxes) or wait for the
            autonomous scheduler if it&apos;s enabled.
          </p>
        ) : mailbox.disconnected ? (
          <p className="text-xs text-muted-foreground/60 italic">
            Disconnected before any real activity was recorded.
          </p>
        ) : null}

        {mailbox.disconnected && (
          <p className="text-xs text-muted-foreground/60">
            Access revoked — this mailbox is no longer part of the warm-up pool. Use &quot;Connect a Gmail mailbox&quot;
            above with the same address to reconnect and resume.
          </p>
        )}

        {(mailbox.oauth_connected || mailbox.disconnected) && (
          <div className="border-t border-border pt-2">
            <button
              type="button"
              onClick={toggleActivity}
              className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn('size-3.5 transition-transform', activityOpen && 'rotate-90')} />
              Recent Activity
            </button>
            {activityOpen && (
              <div className="mt-2 space-y-1.5">
                {loadingActivity ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="size-3" /> Loading…
                  </div>
                ) : activity && activity.length > 0 ? (
                  activity.map(a => <ActivityRow key={a.id} activity={a} />)
                ) : (
                  <p className="text-xs text-muted-foreground/60">No activity yet.</p>
                )}
              </div>
            )}
          </div>
        )}

        {mailbox.oauth_connected && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={ticking} onClick={onTick}>
              {ticking ? <Spinner className="size-3.5" /> : null}
              Run Tick Now
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDisconnectOpen(true)}>
              Disconnect
            </Button>
          </div>
        )}

        <ConfirmDialog
          open={disconnectOpen}
          onOpenChange={setDisconnectOpen}
          title={`Disconnect ${mailbox.mailbox_address}?`}
          description="Revokes this app's access to the mailbox and stops it from sending or receiving warm-up emails. Its warm-up ramp progress and history are kept — reconnecting later resumes where it left off."
          confirmLabel="Disconnect"
          destructive
          loading={disconnecting}
          onConfirm={handleDisconnect}
        />
    </CollapsibleRow>
  )
}

function OutboundWarmupPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [mailboxes, setMailboxes] = useState<Mailbox[]>([])
  const [loading, setLoading] = useState(true)
  const [newAddress, setNewAddress] = useState('')
  const [adding, setAdding] = useState(false)
  const [ticking, setTicking] = useState(false)

  // Same "toast once, strip query params" pattern as the Integrations
  // page's ?gmail_oauth= handling — a top-level browser navigation (the
  // OAuth callback) can't use a fetch()-based success/error response, so
  // it round-trips the outcome through the redirect URL instead.
  useEffect(() => {
    const status = searchParams.get('warmup_oauth')
    if (!status) return
    const message = searchParams.get('warmup_oauth_message')
    if (status === 'success') toast.success(message ?? 'Gmail mailbox connected')
    else toast.error(message ?? 'Gmail connection failed')
    router.replace('/admin/outbound/warmup')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    void loadMailboxes()
  }, [])

  async function loadMailboxes() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/outbound/warmup/mailboxes')
      const data = await res.json()
      if (data.success) setMailboxes(data.mailboxes)
      else toast.error(data.error ?? 'Failed to load mailboxes')
    } catch {
      toast.error('Could not reach the warm-up API')
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd() {
    if (!newAddress.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/admin/outbound/warmup/mailboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mailbox_address: newAddress.trim() }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to add mailbox')
        return
      }
      toast.success(`Warm-up started for ${newAddress.trim()}`)
      setNewAddress('')
      await loadMailboxes()
    } catch {
      toast.error('Could not reach the warm-up API')
    } finally {
      setAdding(false)
    }
  }

  async function handleTick() {
    setTicking(true)
    try {
      const res = await fetch('/api/admin/outbound/warmup/engine/tick', { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Tick failed')
        return
      }
      const s = data.summary
      toast.success(
        `Tick complete — ${s.newExchangesSent} sent, ${s.exchangesProcessed} processed, ${s.rescuedFromSpam} rescued from spam, ${s.repliesSent} replies`
      )
      if (s.errors?.length) toast.warning(`${s.errors.length} error(s) during tick — see server logs`)
      await loadMailboxes()
    } catch {
      toast.error('Could not reach the warm-up engine API')
    } finally {
      setTicking(false)
    }
  }

  const connectedCount = mailboxes.filter(m => m.oauth_connected).length

  return (
    <div className="max-w-2xl space-y-6">
      <GlassCard>
        <CardContent className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Warm-Up</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Mailbox warm-up status and metrics.
          </p>
        </CardContent>
      </GlassCard>

      <motion.div variants={fadeSlideUp} initial="hidden" animate="visible" className="space-y-6">
      <GuideNote>
        <p>
          <strong>Manually-added mailboxes</strong> stay mock-simulated — health is computed from elapsed time, not a
          real inbox test. <strong>OAuth-connected mailboxes</strong> are real: they actually send, open, rescue from
          spam, and reply to each other. The engine needs at least 2 connected mailboxes to do anything, and works
          better with 3+. Honest caveat: a small pool of your own accounts is real signal, but has far less scale and
          diversity than a commercial vendor&apos;s network of thousands of independent mailboxes.
        </p>
      </GuideNote>

      <Card className="border-border bg-card">
        <CardContent className="px-5 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Add Mailbox</h2>
          <Button
            size="sm"
            onClick={() => { window.location.href = '/api/admin/outbound/warmup/oauth/start' }}
          >
            Connect a Gmail mailbox
          </Button>
          <p className="text-xs text-muted-foreground/70">
            Or add a mailbox by address only (mock display, no real engine participation):
          </p>
          <div className="flex gap-2">
            <Input
              aria-label="Mailbox address"
              value={newAddress}
              onChange={e => setNewAddress(e.target.value)}
              placeholder="sales@yourdomain.com"
            />
            <Button size="sm" variant="outline" disabled={adding || !newAddress.trim()} onClick={handleAdd}>
              {adding ? <Spinner className="size-3.5" /> : null}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Spinner className="size-4" /> Loading mailboxes…
        </div>
      ) : mailboxes.length === 0 ? (
        <EmptyState
          icon={Flame}
          title="No mailboxes under warm-up yet"
          description="Connect a real Gmail mailbox, or add one by address, above."
        />
      ) : (
        <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-3">
          {connectedCount < 2 && connectedCount > 0 && (
            <p className="text-xs text-signal-medium">
              Only {connectedCount} connected mailbox — connect at least one more for the engine to have anyone to
              send to.
            </p>
          )}
          {mailboxes.map(mailbox => (
            <motion.div key={mailbox.id} variants={listItem}>
              <MailboxCard mailbox={mailbox} onTick={handleTick} ticking={ticking} onDisconnected={loadMailboxes} />
            </motion.div>
          ))}
        </motion.div>
      )}
      </motion.div>
    </div>
  )
}

export default function OutboundWarmupPage() {
  return (
    <Suspense fallback={null}>
      <OutboundWarmupPageInner />
    </Suspense>
  )
}

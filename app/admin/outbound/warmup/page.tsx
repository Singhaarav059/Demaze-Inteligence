'use client'

// ============================================================
// Email Warm-Up — /admin/outbound/warmup
// ============================================================
// Mailbox cards showing mock-computed warm-up health (emails sent, inbox
// rate, spam rate, domain health) — deterministic function of elapsed
// time since started_at, not a real inbox-placement test.
// ============================================================

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Progress } from '@/components/ui/progress'

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
  live_status: LiveStatus | null
}

function statusBadgeVariant(status: LiveStatus['status']) {
  if (status === 'warmed') return 'default' as const
  if (status === 'warming') return 'secondary' as const
  if (status === 'paused') return 'outline' as const
  return 'outline' as const
}

export default function OutboundWarmupPage() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([])
  const [loading, setLoading] = useState(true)
  const [newAddress, setNewAddress] = useState('')
  const [adding, setAdding] = useState(false)

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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Email Warm-Up</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mock warm-up simulation — metrics are computed from elapsed time, not a real
          inbox-placement test. A real provider (Smartlead/Instantly) is a future vendor decision.
        </p>
      </div>

      <Card className="border-border bg-card">
        <CardContent className="px-5 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Add Mailbox</h2>
          <div className="flex gap-2">
            <Input
              aria-label="Mailbox address"
              value={newAddress}
              onChange={e => setNewAddress(e.target.value)}
              placeholder="sales@yourdomain.com"
            />
            <Button size="sm" disabled={adding || !newAddress.trim()} onClick={handleAdd}>
              {adding ? <Spinner className="size-3.5" /> : null}
              Start Warm-Up
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Spinner className="size-4" /> Loading mailboxes…
        </div>
      ) : mailboxes.length === 0 ? (
        <p className="text-sm text-muted-foreground/70 py-4">No mailboxes under warm-up yet.</p>
      ) : (
        <div className="space-y-3">
          {mailboxes.map(mailbox => (
            <Card key={mailbox.id} className="border-border bg-card">
              <CardContent className="px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{mailbox.mailbox_address}</span>
                  <Badge variant={statusBadgeVariant(mailbox.live_status?.status ?? mailbox.status)}>
                    {mailbox.live_status?.status ?? mailbox.status}
                  </Badge>
                </div>
                {mailbox.live_status && (
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
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

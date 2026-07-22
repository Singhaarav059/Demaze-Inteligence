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

import { useCallback, useEffect, useState } from 'react'
import { Inbox, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { OutboundToolsNav } from '@/components/shell/OutboundToolsNav'
import { useOutboundCampaigns } from './useOutboundCampaigns'

interface AvailableContact {
  id: string
  person_name: string
  company_name: string
  email: string | null
}

function statusBadgeVariant(status: string) {
  if (status === 'sent' || status === 'active') return 'default' as const
  if (status === 'paused' || status === 'queued') return 'secondary' as const
  if (status === 'bounced') return 'destructive' as const
  return 'outline' as const
}

export default function OutboundCampaignsPage() {
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
    createCampaign,
    enqueueContacts,
    sendCampaign,
    pauseOrResume,
  } = useOutboundCampaigns()

  const [newCampaignName, setNewCampaignName] = useState('')
  const [availableContacts, setAvailableContacts] = useState<AvailableContact[]>([])
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set())

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId) ?? null

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
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <OutboundToolsNav />
      <div>
        <h1 className="text-lg font-semibold text-foreground">Outbound Campaigns</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A campaign is a batch of prepared emails sent together to a group of contacts. This is
          the manual/debug version of that step, most of the time you&apos;ll create and send a
          campaign from the Auto Flow page instead, right after preparing outreach.
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Test/demo mode: no real email is delivered here. A real sending service (like Smartlead
          or Instantly) hasn&apos;t been connected yet. This page is the working UI for that, ready to
          switch over once one is.
        </p>
      </div>

      <Card className="border-border bg-card">
        <CardContent className="px-5 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">New Campaign</h2>
          <div className="flex gap-2">
            <Input
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
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="px-5 py-4 space-y-1">
          <Label htmlFor="campaign-picker">Campaign</Label>
          <select
            id="campaign-picker"
            value={selectedCampaignId ?? ''}
            onChange={e => setSelectedCampaignId(e.target.value || null)}
            disabled={loadingCampaigns}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          >
            <option value="">{loadingCampaigns ? 'Loading…' : 'Select a campaign…'}</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.status})
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {selectedCampaign && (
        <>
          <Card className="border-border bg-card">
            <CardContent className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">{selectedCampaign.name}</h2>
                <Badge variant={statusBadgeVariant(selectedCampaign.status)}>{selectedCampaign.status}</Badge>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={sending || campaignContacts.length === 0} onClick={sendCampaign}>
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
              </div>
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
                <div className="space-y-1.5">
                  {campaignContacts.map(cc => (
                    <div key={cc.id} className="flex items-center justify-between text-xs">
                      <span className="text-foreground">
                        {cc.outbound_contacts?.person_name ?? cc.contact_id} · {cc.outbound_contacts?.company_name}
                      </span>
                      <Badge variant={statusBadgeVariant(cc.status)}>{cc.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="px-5 py-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Event Timeline</h3>
              {events.length === 0 ? (
                <EmptyState icon={Clock} title="No events yet" className="border-none py-4" />
              ) : (
                <div className="space-y-1.5">
                  {events.map(e => (
                    <div key={e.id} className="flex items-center justify-between text-xs">
                      <Badge variant="outline">{e.event_type}</Badge>
                      <span className="text-muted-foreground/60">{new Date(e.occurred_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

'use client'

// ============================================================
// useOutboundCampaigns - state + actions for the Campaigns page
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface Campaign {
  id: string
  name: string
  source_run_id: string | null
  status: 'draft' | 'active' | 'paused' | 'completed'
  sender_provider: string
  created_at: string
  // Campaign Settings (migration 020) - all nullable/defaulted, see that
  // migration's own header for the "unset = unrestricted/use global" contract.
  daily_send_limit?: number | null
  send_window_start?: number | null
  send_window_end?: number | null
  timezone?: string
  interval_1_days?: number | null
  interval_2_days?: number | null
  interval_3_days?: number | null
}

export interface CampaignContact {
  id: string
  contact_id: string
  status: string
  provider_message_id: string | null
  outbound_contacts?: { person_name: string; email: string | null; company_name: string } | null
}

export interface CampaignEvent {
  id: string
  event_type: string
  detail: Record<string, unknown>
  occurred_at: string
}

export function useOutboundCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [campaignContacts, setCampaignContacts] = useState<CampaignContact[]>([])
  const [events, setEvents] = useState<CampaignEvent[]>([])
  const [creating, setCreating] = useState(false)
  const [enqueuing, setEnqueuing] = useState(false)
  const [sending, setSending] = useState(false)
  const [pausingOrResuming, setPausingOrResuming] = useState(false)
  const [checkingReplies, setCheckingReplies] = useState(false)
  const [processingFollowups, setProcessingFollowups] = useState(false)

  const loadCampaigns = useCallback(async () => {
    setLoadingCampaigns(true)
    try {
      const res = await fetch('/api/admin/outbound/campaigns')
      const data = await res.json()
      if (data.success) setCampaigns(data.campaigns)
      else toast.error(data.error ?? 'Failed to load campaigns')
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setLoadingCampaigns(false)
    }
  }, [])

  const loadCampaignContacts = useCallback(async (campaignId: string) => {
    try {
      const res = await fetch(`/api/admin/outbound/campaigns/${campaignId}/contacts`)
      const data = await res.json()
      if (data.success) setCampaignContacts(data.contacts)
    } catch {
      toast.error('Could not load campaign contacts')
    }
  }, [])

  const loadEvents = useCallback(async (campaignId: string) => {
    try {
      const res = await fetch(`/api/admin/outbound/campaigns/${campaignId}/events`)
      const data = await res.json()
      if (data.success) setEvents(data.events)
    } catch {
      toast.error('Could not load campaign events')
    }
  }, [])

  useEffect(() => {
    // Intentional fetch-on-mount, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCampaigns()
  }, [loadCampaigns])

  useEffect(() => {
    if (selectedCampaignId) {
      // Intentional fetch-on-dependency-change, not a derived-state anti-pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadCampaignContacts(selectedCampaignId)
      void loadEvents(selectedCampaignId)
    } else {
      setCampaignContacts([])
      setEvents([])
    }
  }, [selectedCampaignId, loadCampaignContacts, loadEvents])

  const createCampaign = useCallback(async (name: string, sourceRunId?: string) => {
    setCreating(true)
    try {
      const res = await fetch('/api/admin/outbound/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, source_run_id: sourceRunId || undefined }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to create campaign')
        return
      }
      setCampaigns(prev => [data.campaign, ...prev])
      setSelectedCampaignId(data.campaign.id)
      toast.success(`Campaign "${name}" created`)
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setCreating(false)
    }
  }, [])

  const enqueueContacts = useCallback(
    async (contactIds: string[]) => {
      if (!selectedCampaignId || contactIds.length === 0) return
      setEnqueuing(true)
      try {
        const res = await fetch(`/api/admin/outbound/campaigns/${selectedCampaignId}/contacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_ids: contactIds }),
        })
        const data = await res.json()
        if (!data.success) {
          toast.error(data.error ?? 'Failed to enqueue contacts')
          return
        }
        toast.success(`Added ${contactIds.length} contact(s) to campaign`)
        await loadCampaignContacts(selectedCampaignId)
      } catch {
        toast.error('Could not reach the campaigns API')
      } finally {
        setEnqueuing(false)
      }
    },
    [selectedCampaignId, loadCampaignContacts]
  )

  const sendCampaign = useCallback(async () => {
    if (!selectedCampaignId) return
    setSending(true)
    try {
      const res = await fetch(`/api/admin/outbound/campaigns/${selectedCampaignId}/send`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Send failed')
        return
      }
      toast.success(`Sent ${data.sent}, skipped ${data.skipped}, failed ${data.failed} (of ${data.total})`)
      await loadCampaignContacts(selectedCampaignId)
      await loadEvents(selectedCampaignId)
      await loadCampaigns()
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setSending(false)
    }
  }, [selectedCampaignId, loadCampaignContacts, loadEvents, loadCampaigns])

  const pauseOrResume = useCallback(
    async (action: 'pause' | 'resume') => {
      if (!selectedCampaignId) return
      setPausingOrResuming(true)
      try {
        const res = await fetch(`/api/admin/outbound/campaigns/${selectedCampaignId}/${action}`, { method: 'POST' })
        const data = await res.json()
        if (!data.success) {
          toast.error(data.error ?? `Failed to ${action}`)
          return
        }
        setCampaigns(prev => prev.map(c => (c.id === selectedCampaignId ? data.campaign : c)))
        toast.success(action === 'pause' ? 'Campaign paused' : 'Campaign resumed')
        await loadEvents(selectedCampaignId)
      } catch {
        toast.error('Could not reach the campaigns API')
      } finally {
        setPausingOrResuming(false)
      }
    },
    [selectedCampaignId, loadEvents]
  )

  // Free, poll-on-demand reply detection - see check-replies/route.ts's
  // header for why this has to be a manual action rather than a timer (this
  // app has no background scheduler). Only does anything useful when Gmail
  // is the active sending provider; the route itself reports that plainly
  // rather than erroring, so the toast surfaces it either way.
  const checkReplies = useCallback(async () => {
    if (!selectedCampaignId) return
    setCheckingReplies(true)
    try {
      const res = await fetch(`/api/admin/outbound/campaigns/${selectedCampaignId}/check-replies`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to check for replies')
        return
      }
      if (data.message) {
        toast.info(data.message)
      } else if (data.newReplies > 0 || data.newBounces > 0) {
        const parts = []
        if (data.newReplies > 0) parts.push(`${data.newReplies} new repl${data.newReplies === 1 ? 'y' : 'ies'}`)
        if (data.newBounces > 0) parts.push(`${data.newBounces} new bounce${data.newBounces === 1 ? '' : 's'} (address${data.newBounces === 1 ? '' : 'es'} suppressed)`)
        toast.success(`${parts.join(', ')} found (checked ${data.checked})`)
      } else {
        toast.info(`No new replies or bounces (checked ${data.checked})`)
      }
      // Surfaced even alongside a success/newReplies toast above - a
      // partial failure (e.g. one contact's reply detected but not
      // recorded) shouldn't be hidden behind an otherwise-good-looking
      // summary. See check-replies/route.ts's 2026-07-29 fix.
      if (Array.isArray(data.errors)) {
        for (const err of data.errors) toast.error(err)
      }
      await loadCampaignContacts(selectedCampaignId)
      await loadEvents(selectedCampaignId)
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setCheckingReplies(false)
    }
  }, [selectedCampaignId, loadCampaignContacts, loadEvents])

  // Follow-up scheduling (2026-07-29) - see followup-schedule.ts and
  // process-followups/route.ts's headers for why this is on-demand too:
  // this app has no background scheduler, so "scheduled" means "computed
  // as due and sent whenever someone clicks this," same shape as
  // checkReplies above.
  const processFollowups = useCallback(async () => {
    if (!selectedCampaignId) return
    setProcessingFollowups(true)
    try {
      const res = await fetch(`/api/admin/outbound/campaigns/${selectedCampaignId}/process-followups`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to process follow-ups')
        return
      }
      if (data.message) {
        toast.info(data.message)
      } else {
        const parts = [`${data.sent} sent`]
        if (data.cancelledByReply > 0) parts.push(`${data.cancelledByReply} cancelled (replied)`)
        if (data.cancelledByBounce > 0) parts.push(`${data.cancelledByBounce} cancelled (bounced, address suppressed)`)
        if (data.skipped > 0) parts.push(`${data.skipped} skipped`)
        if (data.failed > 0) parts.push(`${data.failed} failed`)
        if (data.sent > 0 || data.cancelledByReply > 0 || data.cancelledByBounce > 0 || data.failed > 0) {
          toast.success(`Follow-ups: ${parts.join(', ')} (${data.notDue} not due yet)`)
        } else {
          toast.info(`No follow-ups due yet (${data.checked} contact(s) checked)`)
        }
      }
      await loadCampaignContacts(selectedCampaignId)
      await loadEvents(selectedCampaignId)
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setProcessingFollowups(false)
    }
  }, [selectedCampaignId, loadCampaignContacts, loadEvents])

  return {
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
  }
}

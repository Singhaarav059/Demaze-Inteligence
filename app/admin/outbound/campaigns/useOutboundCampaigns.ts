'use client'

// ============================================================
// useOutboundCampaigns — state + actions for the Campaigns page
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
    createCampaign,
    enqueueContacts,
    sendCampaign,
    pauseOrResume,
  }
}

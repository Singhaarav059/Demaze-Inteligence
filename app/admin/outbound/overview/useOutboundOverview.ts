'use client'

// ============================================================
// useOutboundOverview — state + fetch for the Overview dashboard
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface OverviewStats {
  byStatus: Record<string, number>
  queued: number
  totalContacted: number
  replied: number
  bounced: number
  opened: number
  unsubscribed: number
  followupPending: number
  followupDueNow: number
  replyRate: number
  sentLast24h: number
}

export interface OverviewEmailRow {
  id: string
  campaign_id: string
  contact_id: string
  status: string
  provider_message_id: string | null
  created_at: string
  updated_at: string
  outbound_contacts: { person_name: string; email: string | null; company_name: string; company_domain: string } | null
  outbound_campaigns: { name: string; status: string; sender_provider: string } | null
  outbound_generated_content: { selected_subject_line: string | null; status: string } | null
}

export interface OverviewFilters {
  status: string | null
  campaignId: string | null
  search: string
}

const PAGE_SIZE = 50

export function useOutboundOverview() {
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [emails, setEmails] = useState<OverviewEmailRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<OverviewFilters>({ status: null, campaignId: null, search: '' })

  const load = useCallback(async (f: OverviewFilters, pageOffset: number) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (f.status) qs.set('status', f.status)
      if (f.campaignId) qs.set('campaign_id', f.campaignId)
      if (f.search) qs.set('search', f.search)
      qs.set('limit', String(PAGE_SIZE))
      qs.set('offset', String(pageOffset))

      const res = await fetch(`/api/admin/outbound/overview?${qs.toString()}`)
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to load overview')
        return
      }
      setStats(data.stats)
      setEmails(data.emails)
      setTotal(data.total)
    } catch {
      toast.error('Could not reach the overview API')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Intentional fetch-on-filter-change, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filters, 0)
    setOffset(0)
  }, [filters, load])

  const setStatus = useCallback((status: string | null) => {
    setFilters(prev => ({ ...prev, status }))
  }, [])

  const setCampaignId = useCallback((campaignId: string | null) => {
    setFilters(prev => ({ ...prev, campaignId }))
  }, [])

  const setSearch = useCallback((search: string) => {
    setFilters(prev => ({ ...prev, search }))
  }, [])

  const nextPage = useCallback(() => {
    const next = offset + PAGE_SIZE
    setOffset(next)
    void load(filters, next)
  }, [offset, filters, load])

  const prevPage = useCallback(() => {
    const prev = Math.max(0, offset - PAGE_SIZE)
    setOffset(prev)
    void load(filters, prev)
  }, [offset, filters, load])

  const refresh = useCallback(() => {
    void load(filters, offset)
  }, [filters, offset, load])

  return {
    stats,
    emails,
    total,
    offset,
    pageSize: PAGE_SIZE,
    loading,
    filters,
    setStatus,
    setCampaignId,
    setSearch,
    nextPage,
    prevPage,
    refresh,
  }
}

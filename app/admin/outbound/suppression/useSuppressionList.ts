'use client'

// ============================================================
// useSuppressionList — state + actions for the Suppression List page
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface SuppressionEntry {
  id: string
  email: string
  reason: 'bounced' | 'unsubscribed' | 'manual'
  detail: string | null
  contact_id: string | null
  campaign_id: string | null
  created_at: string
}

export function useSuppressionList() {
  const [entries, setEntries] = useState<SuppressionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/outbound/suppression-list')
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to load suppression list')
        return
      }
      setEntries(data.entries)
    } catch {
      toast.error('Could not reach the suppression list API')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Intentional fetch-on-mount, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const addEntry = useCallback(async (email: string, reason: 'unsubscribed' | 'manual', detail: string) => {
    setAdding(true)
    try {
      const res = await fetch('/api/admin/outbound/suppression-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reason, detail: detail || undefined }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to add')
        return false
      }
      toast.success(`${email} added to the suppression list`)
      await load()
      return true
    } catch {
      toast.error('Could not reach the suppression list API')
      return false
    } finally {
      setAdding(false)
    }
  }, [load])

  const removeEntry = useCallback(async (id: string, email: string) => {
    setRemovingId(id)
    try {
      const res = await fetch(`/api/admin/outbound/suppression-list/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to remove')
        return
      }
      toast.success(`${email} removed from the suppression list`)
      await load()
    } catch {
      toast.error('Could not reach the suppression list API')
    } finally {
      setRemovingId(null)
    }
  }, [load])

  return { entries, loading, adding, removingId, addEntry, removeEntry }
}

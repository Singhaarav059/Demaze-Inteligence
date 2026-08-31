'use client'

// ============================================================
// useFollowupPanel - state + actions for the Follow-up Control Panel
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface FollowupRow {
  id: string
  campaignId: string
  campaignName: string
  campaignPaused: boolean
  contactId: string
  personName: string
  companyName: string
  email: string | null
  status: string
  updatedAt: string
  sequence: 1 | 2 | 3 | null
  dueAt: string | null
  overdue: boolean
  draftSubject: string | null
  draftBody: string | null
}

export function useFollowupPanel() {
  const [rows, setRows] = useState<FollowupRow[]>([])
  const [intervals, setIntervals] = useState<[number, number, number]>([3, 4, 7])
  const [loading, setLoading] = useState(true)
  const [savingIntervals, setSavingIntervals] = useState(false)
  const [busyRowId, setBusyRowId] = useState<string | null>(null)
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/outbound/followups')
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to load follow-ups')
        return
      }
      setRows(data.rows)
      setIntervals(data.intervals)
    } catch {
      toast.error('Could not reach the follow-ups API')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Intentional fetch-on-mount, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const saveIntervals = useCallback(async (next: [number, number, number]) => {
    setSavingIntervals(true)
    try {
      const res = await fetch('/api/admin/outbound/followup-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervals: next }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to save cadence')
        return
      }
      setIntervals(data.intervals)
      toast.success('Cadence updated')
      await load()
    } catch {
      toast.error('Could not reach the settings API')
    } finally {
      setSavingIntervals(false)
    }
  }, [load])

  const sendNow = useCallback(async (rowId: string) => {
    setBusyRowId(rowId)
    try {
      const res = await fetch(`/api/admin/outbound/followups/${rowId}/send-now`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to send follow-up')
        return
      }
      const outcome = data.outcome
      if (outcome.status === 'sent') toast.success('Follow-up sent')
      else if (outcome.status === 'cancelled_reply') toast.info('Not sent - this contact already replied')
      else if (outcome.status === 'failed') toast.error(outcome.reason ?? 'Send failed')
      else toast.warning(outcome.reason ?? `Not sent (${outcome.status})`)
      await load()
    } catch {
      toast.error('Could not reach the follow-ups API')
    } finally {
      setBusyRowId(null)
    }
  }, [load])

  const stopFollowups = useCallback(async (rowId: string) => {
    setBusyRowId(rowId)
    try {
      const res = await fetch(`/api/admin/outbound/followups/${rowId}/stop`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to stop follow-ups')
        return
      }
      if (data.eventWarning) toast.warning(data.eventWarning)
      toast.success('Remaining follow-ups stopped for this contact')
      await load()
    } catch {
      toast.error('Could not reach the follow-ups API')
    } finally {
      setBusyRowId(null)
    }
  }, [load])

  const saveDraft = useCallback(async (row: FollowupRow, newBody: string) => {
    if (row.sequence === null) return
    setSavingDraftId(row.id)
    try {
      const getRes = await fetch(`/api/admin/outbound/contacts/${row.contactId}/generated-content`)
      const getData = await getRes.json()
      if (!getData.success || !getData.generated) {
        toast.error('Could not load this contact\'s generated content')
        return
      }
      const followups: Array<{ sequence: number; body: string; [k: string]: unknown }> =
        getData.generated.followups ?? []
      const nextFollowups = followups.map(f => (f.sequence === row.sequence ? { ...f, body: newBody } : f))

      const res = await fetch(`/api/admin/outbound/contacts/${row.contactId}/generated-content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followups: nextFollowups }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to save edit')
        return
      }
      toast.success('Follow-up copy updated')
      await load()
    } catch {
      toast.error('Could not reach the generated content API')
    } finally {
      setSavingDraftId(null)
    }
  }, [load])

  return {
    rows,
    intervals,
    loading,
    savingIntervals,
    busyRowId,
    savingDraftId,
    load,
    saveIntervals,
    sendNow,
    stopFollowups,
    saveDraft,
  }
}

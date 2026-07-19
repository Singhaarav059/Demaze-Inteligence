'use client'

// ============================================================
// useOutboundContacts — state + actions for the Contacts page
// ============================================================
// Modeled on useCompanyDiscoverySearch.ts's per-item status convention.
// Holds the run picker state, the loaded contact list for the selected
// run, and the add-contact / find-email / enrich / delete actions. Email
// validation was removed (2026-07-19) — it was mock-only, no real vendor
// wired up. Decision-Maker Discovery lives in its own component
// (DecisionMakerFinder.tsx) since it's also reused by the Auto Flow guided
// flow, which doesn't use this hook at all.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface RunOption {
  id: string
  company_url: string
  domain: string
  created_at: string
  final_result?: Record<string, unknown> | null
}

export interface OutboundContact {
  id: string
  source_run_id: string | null
  company_domain: string
  company_name: string
  person_name: string
  title_hint: string | null
  linkedin_url: string | null
  email: string | null
  email_confidence: 'high' | 'medium' | 'low' | 'none' | null
  email_finder_provider: string | null
  email_finder_status: 'pending' | 'found' | 'not_found' | 'error'
  enrichment: Record<string, unknown> | null
  enrichment_status: 'pending' | 'enriched' | 'partial' | 'not_found'
  discovery_source: 'manual' | 'decision_maker_discovery'
  discovery_confidence: 'high' | 'medium' | 'low' | null
  discovery_provider: string | null
  created_at: string
}

type ActionKind = 'find-email' | 'enrich' | 'delete'

export function guessCompanyName(run: RunOption): string {
  const fromResult = run.final_result?.company_name
  if (typeof fromResult === 'string' && fromResult.trim()) return fromResult
  return run.domain
    .replace(/\.[a-z]+$/i, '')
    .split(/[.-]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function useOutboundContacts() {
  const [runs, setRuns] = useState<RunOption[]>([])
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [contacts, setContacts] = useState<OutboundContact[]>([])
  const [loadingContacts, setLoadingContacts] = useState(false)
  const [pendingAction, setPendingAction] = useState<Record<string, ActionKind | undefined>>({})
  const [adding, setAdding] = useState(false)

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true)
    try {
      const res = await fetch('/api/admin/test-runs?limit=50')
      const data = await res.json()
      if (data.success) setRuns(data.runs)
      else toast.error(data.error ?? 'Failed to load runs')
    } catch {
      toast.error('Could not reach the run-history API')
    } finally {
      setLoadingRuns(false)
    }
  }, [])

  const loadContacts = useCallback(async (runId: string) => {
    setLoadingContacts(true)
    try {
      const res = await fetch(`/api/admin/outbound/contacts?source_run_id=${runId}`)
      const data = await res.json()
      if (data.success) setContacts(data.contacts)
      else toast.error(data.error ?? 'Failed to load contacts')
    } catch {
      toast.error('Could not reach the contacts API')
    } finally {
      setLoadingContacts(false)
    }
  }, [])

  useEffect(() => {
    // Intentional fetch-on-mount, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRuns()
  }, [loadRuns])

  useEffect(() => {
    if (selectedRunId) {
      // Intentional fetch-on-dependency-change, not a derived-state anti-pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadContacts(selectedRunId)
    } else {
      setContacts([])
    }
  }, [selectedRunId, loadContacts])

  const selectedRun = runs.find(r => r.id === selectedRunId) ?? null

  const addContact = useCallback(
    async (input: {
      person_name: string
      title_hint?: string
      linkedin_url?: string
      discovery_source?: 'manual' | 'decision_maker_discovery'
      discovery_confidence?: 'high' | 'medium' | 'low'
      discovery_provider?: string
    }) => {
      if (!selectedRun) {
        toast.error('Select a research run first')
        return
      }
      setAdding(true)
      try {
        const res = await fetch('/api/admin/outbound/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_run_id: selectedRun.id,
            company_domain: selectedRun.domain,
            company_name: guessCompanyName(selectedRun),
            person_name: input.person_name,
            title_hint: input.title_hint || undefined,
            linkedin_url: input.linkedin_url || undefined,
            discovery_source: input.discovery_source,
            discovery_confidence: input.discovery_confidence,
            discovery_provider: input.discovery_provider,
          }),
        })
        const data = await res.json()
        if (!data.success) {
          toast.error(data.error ?? 'Failed to add contact')
          return
        }
        setContacts(prev => [data.contact, ...prev])
        toast.success(`Added ${input.person_name}`)
      } catch {
        toast.error('Could not reach the contacts API')
      } finally {
        setAdding(false)
      }
    },
    [selectedRun]
  )

  const findEmailForContact = useCallback(async (contactId: string) => {
    setPendingAction(prev => ({ ...prev, [contactId]: 'find-email' }))
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}/find-email`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Email finder failed')
        return
      }
      setContacts(prev => prev.map(c => (c.id === contactId ? data.contact : c)))
      if (data.result.status === 'found') toast.success(`Found: ${data.result.email}`)
      else toast.warning(data.result.reason ?? 'No email found')
    } catch {
      toast.error('Could not reach the email finder API')
    } finally {
      setPendingAction(prev => ({ ...prev, [contactId]: undefined }))
    }
  }, [])

  const enrichContact = useCallback(async (contactId: string) => {
    setPendingAction(prev => ({ ...prev, [contactId]: 'enrich' }))
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}/enrich`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Enrichment failed')
        return
      }
      setContacts(prev => prev.map(c => (c.id === contactId ? data.contact : c)))
      if (data.result.status === 'not_found') toast.warning('No enrichment data found for this contact')
      else toast.success('Contact enriched')
    } catch {
      toast.error('Could not reach the enrichment API')
    } finally {
      setPendingAction(prev => ({ ...prev, [contactId]: undefined }))
    }
  }, [])

  const deleteContact = useCallback(async (contactId: string) => {
    setPendingAction(prev => ({ ...prev, [contactId]: 'delete' }))
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to delete contact')
        return
      }
      setContacts(prev => prev.filter(c => c.id !== contactId))
      toast.success('Contact deleted')
    } catch {
      toast.error('Could not reach the contacts API')
    } finally {
      setPendingAction(prev => ({ ...prev, [contactId]: undefined }))
    }
  }, [])

  return {
    runs,
    loadingRuns,
    selectedRunId,
    setSelectedRunId,
    selectedRun,
    contacts,
    setContacts,
    loadingContacts,
    adding,
    pendingAction,
    addContact,
    findEmailForContact,
    enrichContact,
    deleteContact,
  }
}

'use client'

// ============================================================
// useSalesKnowledge - loads + mutates all 4 Sales Knowledge lists
// ============================================================
// Same dedicated-hook-file pattern as useOutboundContacts.ts /
// useOutboundCampaigns.ts. Fetches ?include_inactive=1 so the admin CRUD
// page can show and re-activate a soft-deleted row - matcher/generation
// code elsewhere always reads active-only (the default with no query param).
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  SalesKnowledgeIndustry,
  SalesKnowledgeProblem,
  SalesKnowledgeCapability,
  SalesKnowledgeCaseStudy,
} from '@/lib/sales-knowledge/types'

type Entity = 'industries' | 'problems' | 'capabilities' | 'case-studies'

export function useSalesKnowledge() {
  const [industries, setIndustries] = useState<SalesKnowledgeIndustry[]>([])
  const [problems, setProblems] = useState<SalesKnowledgeProblem[]>([])
  const [capabilities, setCapabilities] = useState<SalesKnowledgeCapability[]>([])
  const [caseStudies, setCaseStudies] = useState<SalesKnowledgeCaseStudy[]>([])
  const [loading, setLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [i, p, c, cs] = await Promise.all([
        fetch('/api/admin/sales-knowledge/industries?include_inactive=1').then(r => r.json()),
        fetch('/api/admin/sales-knowledge/problems?include_inactive=1').then(r => r.json()),
        fetch('/api/admin/sales-knowledge/capabilities?include_inactive=1').then(r => r.json()),
        fetch('/api/admin/sales-knowledge/case-studies?include_inactive=1').then(r => r.json()),
      ])
      if (i.success) setIndustries(i.industries)
      if (p.success) setProblems(p.problems)
      if (c.success) setCapabilities(c.capabilities)
      if (cs.success) setCaseStudies(cs.caseStudies)
      if (!i.success || !p.success || !c.success || !cs.success) {
        toast.error('Some Sales Knowledge data failed to load')
      }
    } catch {
      toast.error('Could not reach the Sales Knowledge API')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function create(entity: Entity, payload: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/admin/sales-knowledge/${entity}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Create failed')
        return false
      }
      toast.success('Added')
      await loadAll()
      return true
    } catch {
      toast.error('Could not reach the Sales Knowledge API')
      return false
    }
  }

  async function update(entity: Entity, id: string, payload: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/admin/sales-knowledge/${entity}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Save failed')
        return false
      }
      toast.success('Saved')
      await loadAll()
      return true
    } catch {
      toast.error('Could not reach the Sales Knowledge API')
      return false
    }
  }

  async function remove(entity: Entity, id: string) {
    try {
      const res = await fetch(`/api/admin/sales-knowledge/${entity}/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Delete failed')
        return false
      }
      toast.success('Removed')
      await loadAll()
      return true
    } catch {
      toast.error('Could not reach the Sales Knowledge API')
      return false
    }
  }

  const isEmpty =
    !loading &&
    industries.length === 0 &&
    problems.length === 0 &&
    capabilities.length === 0 &&
    caseStudies.length === 0

  return { industries, problems, capabilities, caseStudies, loading, isEmpty, create, update, remove }
}

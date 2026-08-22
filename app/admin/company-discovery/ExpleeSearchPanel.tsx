'use client'

// ============================================================
// Explee POC panel — raw company search, data-quality check only
// ============================================================
// Deliberately NOT wired into useCompanyDiscoverySearch/CompanyMatchList —
// no selection, no "Research Selected", no dedup against run-history. This
// is a standalone quality check: search Explee, look at what comes back,
// decide whether it's worth building the production pipeline on top of.
// ============================================================

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import type { ExpleeCompany, ExpleeSearchMeta } from '@/lib/enrichment/sources/explee-client'

export function ExpleeSearchPanel() {
  const [definition, setDefinition] = useState('')
  const [geoInclude, setGeoInclude] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companies, setCompanies] = useState<ExpleeCompany[]>([])
  const [meta, setMeta] = useState<ExpleeSearchMeta | null>(null)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  async function handleSearch() {
    if (!definition.trim()) return
    setSearching(true)
    setError(null)
    setCompanies([])
    setMeta(null)

    try {
      const res = await fetch('/api/admin/explee-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition: definition.trim(),
          geoInclude: geoInclude.trim() ? geoInclude.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          pageSize: 20,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error ?? 'Explee search failed')
        return
      }
      setCompanies(data.companies ?? [])
      setMeta(data.meta ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error while searching Explee')
    } finally {
      setSearching(false)
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="px-5 py-4 space-y-3">
        <div>
          <h3 className="text-foreground text-sm font-medium">Explee POC — raw company search</h3>
          <p className="text-muted-foreground/70 text-xs mt-0.5">
            Not wired into research/outreach yet — this is only for checking data quality.
          </p>
        </div>

        <div className="space-y-2 max-w-md">
          <Input
            aria-label="Company definition (natural language)"
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !searching) handleSearch() }}
            placeholder="e.g. mid-size manufacturing company in India"
            className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm"
          />
          <Input
            aria-label="Country codes (optional, comma-separated ISO-2, e.g. IN)"
            value={geoInclude}
            onChange={(e) => setGeoInclude(e.target.value)}
            placeholder="Country codes, optional, e.g. IN"
            className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm"
          />
          <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={handleSearch} disabled={searching || !definition.trim()}>
            {searching ? <><Spinner /> Searching Explee…</> : 'Search Explee'}
          </Button>
        </div>

        {error && <p className="text-destructive text-xs">{error}</p>}

        {meta && (
          <p className="text-muted-foreground/70 text-xs">
            {meta.results_count} of {meta.total} total matches · {meta.credits_charged} credits charged · {meta.remaining_balance} remaining
          </p>
        )}

        {companies.length > 0 && (
          <div className="space-y-1.5">
            {companies.map((c, idx) => (
              <div key={idx} className="rounded-lg border border-border bg-background overflow-hidden">
                <div className="px-3 py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-foreground text-sm font-medium truncate">{c.name ?? 'Unnamed'}</p>
                    <p className="text-muted-foreground/80 text-xs truncate">
                      {[c.domain, c.industry, c.geo_city ?? c.geo, c.size ? `${c.size} employees` : null, c.founded ? `founded ${c.founded}` : null]
                        .filter(Boolean).join(' · ')}
                    </p>
                    {c.description && <p className="text-muted-foreground text-xs mt-1">{c.description}</p>}
                  </div>
                  <button
                    onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                    className="flex-shrink-0 text-muted-foreground hover:text-foreground/90 text-xs px-2 py-1 rounded border border-border hover:border-border transition-colors"
                  >
                    {expandedIdx === idx ? 'Hide raw' : 'View raw'}
                  </button>
                </div>
                {expandedIdx === idx && (
                  <pre className="px-3 pb-3 text-[10px] text-muted-foreground/90 overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(c, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

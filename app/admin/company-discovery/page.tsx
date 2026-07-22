'use client'

// ============================================================
// Discover — /admin/company-discovery
// ============================================================
// Lead-generation engine FOR Demaze itself (demazetech.com), not a generic
// company-research tool. Five explicit, sequential steps (2026-07-16 product
// spec):
//   1. Research Demaze      — understand Demaze's own services/ICPs, build a
//                              structured profile (reuses the existing cached-
//                              research check + fresh-research trigger).
//   2. Target Sectors       — surface Demaze's own ICP segments as real,
//                              named sectors it can serve.
//   3. Sector Selection     — user picks one or more sectors from step 2
//                              (chips), or falls back to a manual/free-text
//                              segment (secondary, advanced path).
//   4. Lead Discovery       — discoverCompanies() across the selected
//                              sector(s), merged/deduped the same way the old
//                              "Find Leads for Demaze" all-segments path
//                              already did (aggregateLeadsAcrossSegments()).
//   5. Research Selected    — the existing sequential one-at-a-time research
//                              loop (CompanyMatchList), each result rendered
//                              via Step1Research (no Competitors/ICP/Market
//                              Intel — those are Demaze's own Discover-level
//                              context from step 1/2, not the lead's report).
//
// No new discovery logic here — this reuses discoverCompanies(),
// discoverICPSegments() (via cached Demaze research), and
// aggregateLeadsAcrossSegments() exactly as they already exist. This file is
// a workflow/UI reorganization over that existing logic.
// ============================================================

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { InfoTooltip } from '@/components/ui/tooltip'
import { fadeSlideUp } from '@/lib/motion'
import type { RunResult } from '../intelligence-lab/_types'
import type { ICPSegment } from '@/lib/enrichment/icp-generator'
import { DEMAZE_URL } from '@/lib/enrichment/demaze-leads'
import { useCompanyDiscoverySearch, toDedupedCompany, type DemazeMatch } from './useCompanyDiscoverySearch'
import { CompanyMatchList } from './CompanyMatchList'

type ProfileStatus = 'idle' | 'checking' | 'needs_research' | 'researching' | 'ready' | 'error'

function StepHeader({ n, title, subtitle, done, tooltip }: { n: number; title: string; subtitle: string; done?: boolean; tooltip?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="relative flex-shrink-0 size-6 mt-0.5 grid place-items-center">
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div
              key="done"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="size-6 rounded-full bg-signal-strong/15 text-signal-strong flex items-center justify-center"
            >
              <svg viewBox="0 0 20 20" fill="none" className="size-3.5" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 10.5L8 14.5L16 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
          ) : (
            <motion.div
              key="num"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="size-6 rounded-full bg-primary/15 text-primary text-xs font-semibold flex items-center justify-center"
            >
              {n}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {title}
          {tooltip && <InfoTooltip>{tooltip}</InfoTooltip>}
        </h2>
        <p className="text-muted-foreground/70 text-xs mt-0.5">{subtitle}</p>
      </div>
    </div>
  )
}

// Placeholder rows shown while an async step is in flight, so the layout
// doesn't jump from "nothing" to "content" — replaces the previous
// button-text-only loading states ("Checking…", "Finding leads…").
function ChipSkeletons() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {[72, 96, 64, 108, 80, 60].map((w, i) => (
        <Skeleton key={i} className="h-6 rounded-full" style={{ width: w }} />
      ))}
    </div>
  )
}

function CompanyRowSkeletons() {
  return (
    <div className="space-y-1.5">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-lg border border-border bg-card px-3 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

function CompanyDiscoveryInner() {
  const searchParams = useSearchParams()
  const search = useCompanyDiscoverySearch({
    initialSegment: searchParams.get('segment') ?? '',
    initialExclude: searchParams.get('exclude') ?? '',
  })
  const {
    icpSegment, setIcpSegment, excludeCompanyName, setExcludeCompanyName,
    searching, searchError, setSearchError, sufficiency, setSufficiency,
    discoveryReason, setDiscoveryReason, setCompanies, handleSearch, persistResult,
  } = search

  // ── Step 1: Research Demaze ──────────────────────────────────
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle')
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [demazeSegments, setDemazeSegments] = useState<ICPSegment[]>([])
  const [demazeResearchedAt, setDemazeResearchedAt] = useState<string | null>(null)

  // ── Step 3: Sector Selection ──────────────────────────────────
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set())

  // ── Step 4: Lead Discovery (multi-sector) ────────────────────
  const [discovering, setDiscovering] = useState(false)

  // Cheap profile check — cached research + segments only, no discovery
  // spend. This is what Steps 1/2 call; discovery (real quota) only happens
  // once the user reaches Step 4.
  async function checkDemazeProfile() {
    setProfileStatus('checking')
    setProfileMessage(null)
    try {
      const res = await fetch('/api/admin/demaze-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'profile' }),
      })
      const data = await res.json()

      if (!data.success) {
        setProfileStatus('error')
        setProfileMessage(data.error ?? 'Failed to check Demaze profile')
        return
      }
      if (data.needsResearch) {
        setProfileStatus('needs_research')
        setProfileMessage('No cached research found for demazetech.com yet. Run it once, then this step reuses that cached result every time after.')
        return
      }

      const segments: ICPSegment[] = data.icpSegments ?? []
      setDemazeSegments(segments)
      setDemazeResearchedAt(data.researchedAt ?? null)
      setProfileStatus('ready')
      setProfileMessage(data.reason ?? null)
      // Default to all sectors selected — one click through to Step 4 for
      // the common case, still fully adjustable in Step 3.
      setSelectedSectors(new Set(segments.map(s => s.name)))
    } catch (e) {
      setProfileStatus('error')
      setProfileMessage(e instanceof Error ? e.message : 'Network error while checking Demaze profile')
    }
  }

  // Explicit second click (separate from checkDemazeProfile's own button) is
  // the user confirmation gate before this spends real Firecrawl/Tavily/LLM
  // quota — same "button click is the confirmation" pattern as "Research
  // Selected" elsewhere in this app, no extra dialog needed.
  async function runDemazeResearchThenCheckProfile() {
    setProfileStatus('researching')
    setProfileMessage('Researching demazetech.com, spends real Firecrawl/Tavily/LLM quota, ~60-90s…')

    try {
      const res = await fetch('/api/admin/test-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: DEMAZE_URL, mode: 'lightweight' }),
      })
      const data: RunResult = await res.json()

      if (!data.success) {
        setProfileStatus('error')
        setProfileMessage(data.error ?? 'Demaze research failed')
        return
      }

      await persistResult(
        { id: 'demaze', companyName: 'Demaze', companyWebsite: DEMAZE_URL, contacts: [], possibleDuplicateOf: [] },
        data,
      )
      toast.success('Demaze research complete')
      await checkDemazeProfile()
    } catch (e) {
      setProfileStatus('error')
      setProfileMessage(e instanceof Error ? e.message : 'Network error while researching Demaze')
      toast.error('Demaze research failed', { description: e instanceof Error ? e.message : undefined })
    }
  }

  function toggleSector(name: string) {
    setSelectedSectors(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }
  function selectAllSectors() {
    setSelectedSectors(new Set(demazeSegments.map(s => s.name)))
  }
  function selectNoSectors() {
    setSelectedSectors(new Set())
  }

  // Step 4 — run discoverCompanies() across every selected sector, merged
  // via the same aggregateLeadsAcrossSegments() the old all-segments flow
  // used, via /api/admin/demaze-leads's mode:'discover' + segments filter.
  async function findLeadsForSelectedSectors() {
    if (selectedSectors.size === 0) {
      setSearchError('Select at least one target sector above, or use the manual segment search below.')
      return
    }
    setDiscovering(true)
    setSearchError(null)
    setSufficiency(null)
    setDiscoveryReason(null)
    setCompanies([])

    try {
      const res = await fetch('/api/admin/demaze-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'discover', segments: Array.from(selectedSectors) }),
      })
      const data = await res.json()

      if (!data.success) {
        setSearchError(data.error ?? 'Lead discovery failed')
        toast.error('Lead discovery failed', { description: data.error })
        return
      }

      const matches: DemazeMatch[] = data.leads ?? []
      setSufficiency(matches.length > 0 ? 'sufficient' : 'insufficient')
      setDiscoveryReason(data.reason ?? null)
      setCompanies(matches.map((match, idx) => ({
        company: toDedupedCompany(match, idx),
        match,
        selected: true,
        status: 'pending' as const,
      })))
      if (matches.length > 0) {
        toast.success(`${matches.length} lead${matches.length === 1 ? '' : 's'} found`)
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Network error while finding leads')
      toast.error('Lead discovery failed', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setDiscovering(false)
    }
  }

  // ── Arrive-via-link autosearch ───────────────────────────────
  // From a report's "Find companies in this segment →" link
  // (?segment=...&exclude=...). Runs once via the manual/advanced search path
  // (this is a specific segment string, not one of Demaze's own sectors).

  const autoSearchedRef = useRef(false)
  useEffect(() => {
    if (autoSearchedRef.current) return
    const segment = searchParams.get('segment')
    if (!segment) return
    autoSearchedRef.current = true
    handleSearch(segment, searchParams.get('exclude') ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-5">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <h1 className="text-xl font-semibold text-foreground">Discover</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Demaze&rsquo;s own lead-generation engine: research Demaze → target sectors → select → find leads → research them</p>
      </motion.div>

      {/* ── Step 1: Research Demaze ─────────────────────────────── */}
      <Card className="bg-card border-primary/30">
        <CardContent className="px-5 py-4 space-y-3">
          <StepHeader
            n={1}
            title="Find Leads for Demaze"
            subtitle="Build (or reuse) a structured Demaze profile: services, ICPs, industries served."
            done={profileStatus === 'ready'}
          />

          <div className="flex items-center gap-2 flex-wrap pl-9">
            <Button size="sm" onClick={checkDemazeProfile} disabled={profileStatus === 'checking' || profileStatus === 'researching'}>
              {profileStatus === 'checking' ? <><Spinner /> Checking…</> : profileStatus === 'ready' ? 'Reload Cached Profile' : 'Check Demaze Profile'}
            </Button>
            {(profileStatus === 'needs_research' || profileStatus === 'ready' || profileStatus === 'error') && (
              <Button size="sm" variant="outline" className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20" onClick={runDemazeResearchThenCheckProfile}>
                {profileStatus === 'ready' ? 'Re-run Research (spends quota)' : 'Run Research Now (spends quota)'}
              </Button>
            )}
            {demazeResearchedAt && (
              <span className="text-muted-foreground/70 text-xs">
                cached research from {new Date(demazeResearchedAt).toLocaleString()}
              </span>
            )}
          </div>

          <AnimatePresence mode="wait">
            {profileStatus === 'researching' && (
              <motion.div key="researching" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="ml-9 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
                <Spinner className="text-primary mr-0" />
                <p className="text-primary">{profileMessage}</p>
              </motion.div>
            )}
            {profileStatus === 'needs_research' && (
              <motion.div key="needs_research" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="ml-9 rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2 text-xs">
                <p className="text-signal-medium">{profileMessage}</p>
              </motion.div>
            )}
            {profileStatus === 'error' && (
              <motion.div key="error" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="ml-9 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <p className="text-destructive">{profileMessage}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* ── Step 2: Target Sectors ───────────────────────────────── */}
      <AnimatePresence>
        {(profileStatus === 'ready' || profileStatus === 'checking') && (
          <motion.div key="step2" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit">
            <Card className="bg-card border-border">
              <CardContent className="px-5 py-4 space-y-3">
                <StepHeader
                  n={2}
                  title="Target Sectors"
                  subtitle="Demaze's confirmed target industries, plus any additional sectors surfaced from its own real research."
                  done={profileStatus === 'ready' && demazeSegments.length > 0}
                  tooltip="Sectors here come from two sources merged together: Demaze's confirmed ground-truth target industries, and any additional sectors its own website research surfaced."
                />
                <div className="pl-9">
                  {profileStatus === 'checking' ? (
                    <ChipSkeletons />
                  ) : demazeSegments.length === 0 ? (
                    <p className="text-muted-foreground/70 text-xs">No target sectors surfaced by Demaze&rsquo;s cached research yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {demazeSegments.map(seg => (
                        <Badge key={seg.name} className="text-xs bg-accent text-foreground/90 px-2.5 py-1">{seg.name}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Step 3: Sector Selection ─────────────────────────────── */}
      <AnimatePresence>
        {profileStatus === 'ready' && (
          <motion.div key="step3" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit">
            <Card className="bg-card border-border">
              <CardContent className="px-5 py-4 space-y-3">
                <StepHeader
                  n={3}
                  title="Sector Selection"
                  subtitle="Pick one or more sectors to search. Discovery runs across everything selected."
                  done={selectedSectors.size > 0}
                />

            <div className="pl-9 space-y-3">
              {demazeSegments.length > 0 && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {demazeSegments.map(seg => {
                      const isSelected = selectedSectors.has(seg.name)
                      return (
                        <motion.button
                          key={seg.name}
                          type="button"
                          onClick={() => toggleSector(seg.name)}
                          whileTap={{ scale: 0.94 }}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            isSelected
                              ? 'border-primary/50 bg-primary/15 text-primary'
                              : 'border-border bg-transparent text-muted-foreground hover:bg-accent'
                          }`}
                        >
                          {isSelected ? '✓ ' : ''}{seg.name}
                        </motion.button>
                      )
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={selectAllSectors}>Select all</Button>
                    <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={selectNoSectors}>Select none</Button>
                    <span className="text-muted-foreground text-xs">{selectedSectors.size} of {demazeSegments.length} selected</span>
                  </div>
                </>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground/70 hover:text-foreground/80">Manual / advanced: search a segment by free text instead</summary>
                <div className="mt-3 space-y-2 max-w-md">
                  <Input
                    aria-label="ICP segment to search"
                    value={icpSegment}
                    onChange={(e) => setIcpSegment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !searching) handleSearch() }}
                    placeholder="e.g. automotive manufacturers, oil and gas, mid-size SaaS companies…"
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm"
                  />
                  <Input
                    aria-label="Exclude companies (optional, comma-separated)"
                    value={excludeCompanyName}
                    onChange={(e) => setExcludeCompanyName(e.target.value)}
                    placeholder="Exclude companies (optional, comma-separated)"
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm"
                  />
                  <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={() => handleSearch()} disabled={searching || !icpSegment.trim()}>
                    {searching ? <><Spinner /> Searching…</> : 'Find Companies for This Segment'}
                  </Button>
                </div>
              </details>
            </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Step 4: Lead Discovery ───────────────────────────────── */}
      <AnimatePresence>
        {profileStatus === 'ready' && (
          <motion.div key="step4" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit">
            <Card className="bg-card border-border">
              <CardContent className="px-5 py-4 space-y-3">
                <StepHeader
                  n={4}
                  title="Lead Discovery"
                  subtitle="Find companies matching Demaze's services/ICPs across the selected sector(s)."
                  done={sufficiency === 'sufficient'}
                />
                <div className="pl-9 space-y-2">
                  <Button size="sm" onClick={findLeadsForSelectedSectors} disabled={discovering || selectedSectors.size === 0}>
                    {discovering ? <><Spinner /> Finding leads…</> : `Find Leads (${selectedSectors.size} sector${selectedSectors.size === 1 ? '' : 's'})`}
                  </Button>

                  <AnimatePresence mode="wait">
                    {discovering && (
                      <motion.div key="discovering-skeleton" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit">
                        <CompanyRowSkeletons />
                      </motion.div>
                    )}
                    {searchError && (
                      <motion.div key="search-error" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                        <p className="text-destructive">{searchError}</p>
                      </motion.div>
                    )}
                    {sufficiency === 'insufficient' && !searchError && (
                      <motion.div key="insufficient" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2 text-xs">
                        <p className="text-signal-medium">No companies surfaced: {discoveryReason}</p>
                      </motion.div>
                    )}
                    {sufficiency === 'sufficient' && discoveryReason && (
                      <motion.p key="sufficient-reason" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="text-muted-foreground/70 text-xs">
                        {discoveryReason}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Step 5: Research Selected → Outreach ─────────────────── */}
      <CompanyMatchList search={search} demazeSegments={demazeSegments} />
    </div>
  )
}

export default function CompanyDiscoveryPage() {
  return (
    <Suspense fallback={null}>
      <CompanyDiscoveryInner />
    </Suspense>
  )
}

'use client'

// ============================================================
// Discover Companies - /admin/company-discovery
// ============================================================
// Demaze's own company-discovery workflow: define who to target, review
// matching companies, then research the ones worth pursuing with Demaze's
// intelligence pipeline. Explee is the data source behind every search
// (see useCompanyDiscoverySearch.ts / lib/enrichment/sources/
// explee-client.ts) and is deliberately never named, linked, or exposed
// here - no vendor terminology, credits, provider selection, or raw API
// fields. Every filter on this page maps to a real, verified field on
// Explee's own schema (see search-options.ts's header comment) - nothing
// here is a client-side-only control that the underlying search ignores.
// ============================================================

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, MapPin, Filter, HelpCircle, Search, Clock, ChevronRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { GuideNote } from '@/components/ui/guide-note'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { fadeSlideUp } from '@/lib/motion'
import { useCompanyDiscoverySearch } from './useCompanyDiscoverySearch'
import type { DiscoveredMatch } from './useCompanyDiscoverySearch'
import { CompanyMatchList } from './CompanyMatchList'
import {
  SECTOR_OPTIONS, EMPLOYEE_RANGES, REVENUE_RANGES, REGION_OPTIONS,
  COMPANY_TYPE_FILTERS, PRESENCE_FILTERS, allCountryOptions,
  type SectorOption,
} from './search-options'

// A segment is a persisted "target market" search - replaces the old
// localStorage-only recent-searches list. Saved automatically after every
// successful search (see saveSegment() below); the Home dashboard's
// "Continue where you left off" section reads the same rows via the same
// GET /api/admin/company-discovery/segments endpoint, so a search started
// here can be resumed from either place.
interface SegmentFilters {
  sector: SectorOption
  regionKeys: string[]
  customCountries: string[]
  countries: string[]
  employeeRangeKey: string
  revenueRangeKey: string
  foundedAfter: string
  foundedBefore: string
  companyTypeKeys: string[]
  presenceKeys: string[]
  excludeKeywords: string
}

interface Segment {
  id: string
  name: string
  sector: SectorOption
  filters: SegmentFilters
  totalFound: number
  researchedCount: number
  totalCount: number
  createdAt: string
  lastViewedAt: string
}

async function fetchSegments(limit = 5): Promise<Segment[]> {
  try {
    const res = await fetch(`/api/admin/company-discovery/segments?limit=${limit}`)
    const data = await res.json()
    return data.success ? (data.segments as Segment[]) : []
  } catch {
    return []
  }
}

async function saveSegment(name: string, sector: SectorOption, filters: SegmentFilters, matches: DiscoveredMatch[], totalFound: number): Promise<void> {
  try {
    await fetch('/api/admin/company-discovery/segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        sector,
        filters,
        totalFound,
        companies: matches.map(m => ({
          name: m.name,
          domain: m.domain,
          industry: m.industry,
          employeeCount: m.employeeCount,
          hqLocation: m.hqLocation,
          founded: m.founded,
          revenueAnnual: m.revenueAnnual,
        })),
      }),
    })
  } catch {
    // Best-effort only - a failed save shouldn't block or error out the search itself.
  }
}

function CompanyRowSkeletons() {
  return (
    <div className="space-y-1.5">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-lg border border-border bg-card px-3.5 py-3 space-y-2">
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

function PillToggle({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className={`inline-flex items-center gap-1 text-sm px-3.5 py-1.5 rounded-full border transition-colors ${
        selected
          ? 'border-primary/50 bg-primary/15 text-primary font-medium'
          : 'border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground/90'
      }`}
    >
      {selected && <Check className="size-3" />}
      {label}
    </motion.button>
  )
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground/90 cursor-pointer hover:text-foreground/80">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-primary" />
      {label}
    </label>
  )
}

function FilterSection({ label, icon: Icon, hint, children }: { label: string; icon?: React.ComponentType<{ className?: string }>; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-border/50 pt-4 first:border-t-0 first:pt-0">
      <Label className="gap-1.5 text-xs">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />} {label}
      </Label>
      {hint && <p className="text-muted-foreground/50 text-[11px]">{hint}</p>}
      {children}
    </div>
  )
}

function CompanyDiscoveryInner() {
  const searchParams = useSearchParams()
  const search = useCompanyDiscoverySearch()
  const { searching, searchError, sufficiency, discoveryReason } = search

  const [sector, setSector] = useState<SectorOption | ''>('')
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set())
  const [customCountries, setCustomCountries] = useState<Set<string>>(new Set())
  const [countryFilterText, setCountryFilterText] = useState('')
  const [employeeRangeKey, setEmployeeRangeKey] = useState('')
  const [revenueRangeKey, setRevenueRangeKey] = useState('')
  const [foundedAfter, setFoundedAfter] = useState('')
  const [foundedBefore, setFoundedBefore] = useState('')
  const [companyTypeKeys, setCompanyTypeKeys] = useState<Set<string>>(new Set())
  const [presenceKeys, setPresenceKeys] = useState<Set<string>>(new Set())
  const [excludeKeywords, setExcludeKeywords] = useState('')
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [segments, setSegments] = useState<Segment[]>([])

  const searchCardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetchSegments().then(setSegments)
  }, [])

  function scrollToSearch() {
    searchCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function toggleInSet<T>(set: Set<T>, setter: (s: Set<T>) => void, value: T) {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  function resolvedCountries(): string[] {
    const regionCountries = REGION_OPTIONS.filter(r => selectedRegions.has(r.key)).flatMap(r => r.countries)
    return Array.from(new Set([...regionCountries, ...customCountries]))
  }

  function buildSegmentName(forSector: SectorOption, regionKeys: string[]): string {
    const regionLabel = regionKeys.length > 0
      ? regionKeys.map(k => REGION_OPTIONS.find(r => r.key === k)?.label ?? k).join(', ')
      : null
    return regionLabel ? `${forSector} • ${regionLabel}` : forSector
  }

  function currentSegmentFilters(forSector: SectorOption): SegmentFilters {
    return {
      sector: forSector,
      regionKeys: Array.from(selectedRegions),
      customCountries: Array.from(customCountries),
      countries: resolvedCountries(),
      employeeRangeKey,
      revenueRangeKey,
      foundedAfter,
      foundedBefore,
      companyTypeKeys: Array.from(companyTypeKeys),
      presenceKeys: Array.from(presenceKeys),
      excludeKeywords,
    }
  }

  async function runSearch() {
    if (!sector) {
      search.setSearchError('Select an industry to search.')
      return
    }
    const filters = currentSegmentFilters(sector)
    const { count, matches, total } = await search.handleSearch({
      sector,
      countries: filters.countries,
      employeeRangeKey: employeeRangeKey || undefined,
      revenueRangeKey: revenueRangeKey || undefined,
      foundedAfter: foundedAfter ? Number(foundedAfter) : undefined,
      foundedBefore: foundedBefore ? Number(foundedBefore) : undefined,
      companyTypeKeys: filters.companyTypeKeys,
      presenceKeys: filters.presenceKeys,
      excludeKeywords: excludeKeywords.split(',').map(s => s.trim()).filter(Boolean),
    })
    if (count > 0 && matches.length > 0) {
      await saveSegment(buildSegmentName(sector, filters.regionKeys), sector, filters, matches, total || count)
      setSegments(await fetchSegments())
    }
  }

  async function applySegment(segment: Segment) {
    const f = segment.filters
    setSector(f.sector)
    setSelectedRegions(new Set(f.regionKeys))
    setCustomCountries(new Set(f.customCountries))
    setEmployeeRangeKey(f.employeeRangeKey)
    setRevenueRangeKey(f.revenueRangeKey)
    setFoundedAfter(f.foundedAfter)
    setFoundedBefore(f.foundedBefore)
    setCompanyTypeKeys(new Set(f.companyTypeKeys))
    setPresenceKeys(new Set(f.presenceKeys))
    setExcludeKeywords(f.excludeKeywords)
    scrollToSearch()
    // Re-run the same search so the results list matches - but don't save a
    // new segment row here. researchedCount/totalCount are computed fresh
    // on every GET from the *existing* snapshot, so there's nothing to
    // refresh; re-saving would just create a visible duplicate in Recent
    // Searches (found via live testing, not guessed).
    await search.handleSearch({
      sector: f.sector,
      countries: f.countries,
      employeeRangeKey: f.employeeRangeKey || undefined,
      revenueRangeKey: f.revenueRangeKey || undefined,
      foundedAfter: f.foundedAfter ? Number(f.foundedAfter) : undefined,
      foundedBefore: f.foundedBefore ? Number(f.foundedBefore) : undefined,
      companyTypeKeys: f.companyTypeKeys,
      presenceKeys: f.presenceKeys,
      excludeKeywords: f.excludeKeywords.split(',').map(s => s.trim()).filter(Boolean),
    })
    await fetch(`/api/admin/company-discovery/segments/${segment.id}`, { method: 'PATCH' })
    setSegments(await fetchSegments())
  }

  // ── Arrive-via-link autosearch ───────────────────────────────
  // From a report's "Find companies in this segment →" link
  // (?segment=...&exclude=...). Runs once; bypasses the industry select
  // with the segment's own free-text description.
  const autoSearchedRef = useRef(false)
  useEffect(() => {
    if (autoSearchedRef.current) return
    const segment = searchParams.get('segment')
    if (!segment) return
    autoSearchedRef.current = true
    search.handleSearch({ definitionOverride: segment, excludeCompanyName: searchParams.get('exclude') ?? undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Resume a saved segment ─────────────────────────────────────
  // From the Home dashboard's "Continue where you left off" cards
  // (?resumeSegmentId=...) - a real segment id, distinct from the free-text
  // ?segment= param above. Runs once, prefills every filter, then re-runs
  // the exact same search.
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current) return
    const resumeSegmentId = searchParams.get('resumeSegmentId')
    if (!resumeSegmentId) return
    resumedRef.current = true
    void (async () => {
      try {
        const res = await fetch(`/api/admin/company-discovery/segments/${resumeSegmentId}`)
        const data = await res.json()
        if (data.success && data.segment) {
          await applySegment({ ...data.segment, researchedCount: 0, totalCount: 0 } as Segment)
        }
      } catch {
        // Best-effort - if the segment can't be loaded, the page just shows
        // its normal empty state instead of erroring out.
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredCountries = countryFilterText.trim()
    ? allCountryOptions().filter(c => c.label.toLowerCase().includes(countryFilterText.trim().toLowerCase())).slice(0, 30)
    : []

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-muted-foreground/50 text-xs">Demaze <span className="mx-1">›</span> Discover</p>
          <h1 className="text-xl font-semibold text-foreground mt-0.5">Discover Companies</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Find companies worth researching.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button size="sm" variant="outline" onClick={() => setShowHowItWorks(v => !v)}>
            <HelpCircle className="size-3.5" /> How it works
          </Button>
          <Button size="sm" onClick={scrollToSearch}>
            <Search className="size-3.5" /> Back to search
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {showHowItWorks && (
          <motion.div variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit">
            <GuideNote>
              <p><strong>1. Define the companies worth researching</strong> - industry, size, revenue, and headquarters.</p>
              <p><strong>2. Review matching companies</strong> - a manageable, relevant set, not a giant database dump.</p>
              <p><strong>3. Research with Demaze</strong> - select the ones you want and Demaze finds recent business signals, potential challenges, and Demaze opportunities for each.</p>
            </GuideNote>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={searchCardRef} className="rounded-lg border border-border bg-card">
        <div className="px-4 py-2.5 border-b border-border/60">
          <h2 className="text-sm font-semibold text-foreground">Target market</h2>
          <p className="text-muted-foreground/60 text-xs mt-0.5">Set the criteria Demaze should search for - a focused, relevant set, not a database dump.</p>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="space-y-1.5">
              <Label className="gap-1.5 text-xs">
                <Building2 className="size-3.5 text-muted-foreground" /> Industry
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {SECTOR_OPTIONS.map(s => (
                  <PillToggle key={s} label={s} selected={sector === s} onClick={() => setSector(s)} />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="employee-range-select" className="text-xs">
                Company size <span className="text-muted-foreground/60 font-normal">(optional)</span>
              </Label>
              <Select
                items={EMPLOYEE_RANGES.map(r => ({ value: r.key, label: r.label }))}
                value={employeeRangeKey}
                onValueChange={(v) => setEmployeeRangeKey(v as string)}
              >
                <SelectTrigger id="employee-range-select" className="w-44">
                  <SelectValue placeholder="Any size" />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_RANGES.map(r => (
                    <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="revenue-range-select" className="text-xs">
                Annual revenue <span className="text-muted-foreground/60 font-normal">(optional)</span>
              </Label>
              <Select
                items={REVENUE_RANGES.map(r => ({ value: r.key, label: r.label }))}
                value={revenueRangeKey}
                onValueChange={(v) => setRevenueRangeKey(v as string)}
              >
                <SelectTrigger id="revenue-range-select" className="w-44">
                  <SelectValue placeholder="Any revenue" />
                </SelectTrigger>
                <SelectContent>
                  {REVENUE_RANGES.map(r => (
                    <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <FilterSection label="Headquarters (optional)" icon={MapPin} hint="Company headquarters, not customer or sales regions.">
            <div className="flex flex-wrap gap-1.5">
              {REGION_OPTIONS.map(r => (
                <PillToggle
                  key={r.key}
                  label={r.label}
                  selected={selectedRegions.has(r.key)}
                  onClick={() => toggleInSet(selectedRegions, setSelectedRegions, r.key)}
                />
              ))}
            </div>
          </FilterSection>

          <details className="group text-xs border-t border-border/50 pt-3">
            <summary className="cursor-pointer list-none text-muted-foreground/70 hover:text-foreground/80 flex items-center gap-1.5 w-fit select-none">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
              <Filter className="size-3.5" /> Advanced filters
            </summary>
            <div className="mt-4 space-y-4 max-w-2xl rounded-lg border border-border bg-background/40 px-4 py-4">
              <div className="space-y-1.5">
                <Label>More locations</Label>
                {customCountries.size > 0 && (
                  <div className="flex flex-wrap gap-1.5 pb-1">
                    {Array.from(customCountries).map(code => (
                      <PillToggle
                        key={code}
                        label={allCountryOptions().find(c => c.code === code)?.label ?? code}
                        selected
                        onClick={() => toggleInSet(customCountries, setCustomCountries, code)}
                      />
                    ))}
                  </div>
                )}
                <Input
                  value={countryFilterText}
                  onChange={(e) => setCountryFilterText(e.target.value)}
                  placeholder="Search countries…"
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm max-w-xs"
                />
                {filteredCountries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1 max-h-32 overflow-y-auto">
                    {filteredCountries.map(c => (
                      <PillToggle
                        key={c.code}
                        label={c.label}
                        selected={customCountries.has(c.code)}
                        onClick={() => toggleInSet(customCountries, setCustomCountries, c.code)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Founded</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={foundedAfter}
                    onChange={(e) => setFoundedAfter(e.target.value)}
                    placeholder="After (e.g. 2010)"
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm w-40"
                  />
                  <span className="text-muted-foreground/50">–</span>
                  <Input
                    type="number"
                    value={foundedBefore}
                    onChange={(e) => setFoundedBefore(e.target.value)}
                    placeholder="Before (e.g. 2023)"
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm w-40"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Company type</Label>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {COMPANY_TYPE_FILTERS.map(f => (
                    <Checkbox
                      key={f.key}
                      label={f.label}
                      checked={companyTypeKeys.has(f.key)}
                      onChange={() => toggleInSet(companyTypeKeys, setCompanyTypeKeys, f.key)}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Company presence</Label>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {PRESENCE_FILTERS.map(f => (
                    <Checkbox
                      key={f.key}
                      label={f.label}
                      checked={presenceKeys.has(f.key)}
                      onChange={() => toggleInSet(presenceKeys, setPresenceKeys, f.key)}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exclude-keywords">Exclude keywords <span className="text-muted-foreground/60 font-normal">(optional)</span></Label>
                <Input
                  id="exclude-keywords"
                  value={excludeKeywords}
                  onChange={(e) => setExcludeKeywords(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !searching) runSearch() }}
                  placeholder="e.g. academy, jobs, careers"
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm max-w-xs"
                />
              </div>
            </div>
          </details>

          <div className="flex items-center gap-3 flex-wrap border-t border-border/50 pt-3">
            <Button size="lg" onClick={runSearch} disabled={searching || !sector}>
              {searching ? <><Spinner /> Finding matching companies…</> : <><Search className="size-4" /> Find Companies</>}
            </Button>
            {!sector && <span className="text-muted-foreground/50 text-xs">Select an industry to get started.</span>}
          </div>

          <AnimatePresence mode="wait">
            {searchError && (
              <motion.div key="search-error" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <p className="text-destructive">{searchError}</p>
              </motion.div>
            )}
            {sufficiency === 'insufficient' && !searchError && (
              <motion.div key="insufficient" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2 text-xs">
                <p className="text-signal-medium">{discoveryReason}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {segments.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground/80 flex items-center gap-1.5">
            <Clock className="size-3.5" /> Recent Searches
          </h3>
          <div className="space-y-1.5">
            {segments.map((seg) => (
              <button
                key={seg.id}
                onClick={() => applySegment(seg)}
                disabled={searching}
                className="w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent hover:border-border-strong transition-colors disabled:opacity-50"
              >
                <div className="min-w-0">
                  <p className="text-foreground text-xs font-medium truncate">{seg.name}</p>
                  <p className="text-muted-foreground/60 text-[11px] mt-0.5">
                    {seg.totalCount} compan{seg.totalCount === 1 ? 'y' : 'ies'} · {seg.researchedCount} of {seg.totalCount} researched · {new Date(seg.lastViewedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <ChevronRight className="size-3.5 text-muted-foreground/50 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {searching && <CompanyRowSkeletons />}

      <CompanyMatchList search={search} onAdjustSearch={scrollToSearch} />
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

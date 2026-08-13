'use client'

// ============================================================
// DecisionMakerFinder — search for candidate decision-makers by title,
// review, and add selected ones as real contacts.
// ============================================================
// Extracted out of contacts/page.tsx so it's reusable by the Auto Flow
// guided-flow page (app/admin/auto-gtm) as well. Fully self-contained —
// takes only the company identity it needs, calls the discovery + contact-
// creation APIs directly, and reports each newly-created contact back to
// the caller via onContactAdded rather than depending on any shared hook.
// ============================================================

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { StageProgress, type ProgressStage } from '@/components/ui/stage-progress'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { staggerList, listItem } from '@/lib/motion'
import { DEFAULT_TARGET_TITLES } from '@/lib/outbound/decision-maker-discovery/types'
import { recommendTitlesFromResearch } from '@/lib/outbound/decision-maker-discovery/role-recommendation'
import { classifyRoleCategory, ROLE_CATEGORY_LABELS, type RoleCategory } from '@/lib/outbound/decision-maker-discovery/role-category'
import type { DecisionMakerCandidate, LeadershipContactInput } from '@/lib/outbound/decision-maker-discovery/types'
import type { OutboundContact } from './useOutboundContacts'

// Hedged as "likely current activity" — same honesty discipline as
// auto-gtm/page.tsx's RESEARCH_STAGES, see stage-progress.tsx's header
// comment for why this isn't a real measured percentage.
const DISCOVERY_STAGES: ProgressStage[] = [
  { label: 'Searching for candidates…', afterMs: 0 },
  { label: 'Verifying matches…', afterMs: 5_000 },
  { label: 'Almost done…', afterMs: 15_000 },
]

// Placeholder rows shown while a search is in flight, so the layout doesn't
// jump from "nothing" to "content" — same pattern as company-discovery/
// page.tsx's CompanyRowSkeletons.
function CandidateRowSkeletons() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map(i => (
        <div key={i} className="flex items-center gap-2.5">
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// Imperative handle so a parent step (Auto Flow) can trigger "add whatever
// is currently checked" itself — e.g. from its own "Continue" button —
// instead of requiring a separate "Add Selected as Contacts" click here.
export interface DecisionMakerFinderHandle {
  commitSelected: () => Promise<void>
}

function confidenceBadgeVariant(confidence: 'high' | 'medium' | 'low') {
  if (confidence === 'high') return 'default' as const
  if (confidence === 'medium') return 'secondary' as const
  return 'outline' as const
}

function groundingBadgeVariant(status: 'confirmed' | 'conflict' | 'not_found') {
  if (status === 'confirmed') return 'default' as const
  if (status === 'conflict') return 'destructive' as const
  return 'outline' as const
}

function groundingLabel(status: 'confirmed' | 'conflict' | 'not_found') {
  if (status === 'confirmed') return 'Confirmed on website'
  if (status === 'conflict') return 'Conflicts with website'
  return 'Not on website'
}

export const DecisionMakerFinder = forwardRef<DecisionMakerFinderHandle, {
  companyName: string
  domain: string
  sourceRunId: string
  onContactAdded: (contact: OutboundContact) => void
  // When true, searches automatically on mount using the default target
  // titles below — no click needed. Used by Auto Flow so decision-maker
  // discovery happens without the user asking for it; the search box stays
  // here so they can still adjust titles and re-run by hand if they want to.
  autoStart?: boolean
  // When true, the target-titles input collapses behind an "Adjust titles"
  // toggle instead of always showing, and the "Add Selected as Contacts"
  // button is hidden — used by the Auto Flow guided flow's Decision Makers
  // step, which wants "search runs automatically, user just selects, and
  // the flow's own Continue button commits the selection" (via the
  // commitSelected imperative handle above) instead of a separate add step.
  // The standalone Contacts page keeps everything always visible (default false).
  compact?: boolean
  // Fires whenever the checked-candidate count changes, so a compact-mode
  // parent (Auto Flow) can enable/disable its own Continue button without
  // duplicating selection state here.
  onSelectionChange?: (count: number) => void
  // Fires once a discovery attempt has settled — either a cache restore, or
  // a live search's success/failure — regardless of outcome. Auto Flow uses
  // this as the trigger to auto-commit and auto-advance past this step with
  // no manual "Continue" click (2026-08-13 automation).
  onDiscoveryComplete?: () => void
  // Named leadership individuals already extracted from the company's own
  // scraped site (lib/pipeline/evidence-extractor.ts's leadershipContacts).
  // Optional — when provided, every returned candidate is cross-checked
  // against it server side and gets a "Confirmed on website" / "Conflicts
  // with website" / "Not on website" badge (2026-07-18 grounding fix). Auto
  // Flow passes this from the live run's extractorResult; the standalone
  // Contacts page passes it via getLeadershipContacts() on the saved run's
  // final_result (2026-07-19 fix — leadership_contacts is now a real
  // top-level NormalizedAnalysis field, see normalize.ts). Only genuinely
  // omitted for a run saved before that field existed — those still show
  // candidates ungrounded rather than erroring.
  leadershipContacts?: LeadershipContactInput[]
  // Full pipeline research output for this company, when available — used
  // ONLY to recommend which titles to search for (operational pain -> VP
  // Operations/COO, tech pain -> CTO/CIO, sales/marketing pain -> CRO/VP
  // Sales), never to discover or rank WHO the contact is. Optional — omit
  // to fall back to the generic DEFAULT_TARGET_TITLES with no recommendation
  // section shown, same as before this existed.
  analysisResult?: Record<string, unknown> | null
  // Sales Intelligence's recommended_roles (active override, else the
  // matcher's recommendation) — a second, additive source of "recommended"
  // titles alongside role-recommendation.ts's own research-derived groups
  // above. Purely a client-side "N found / M recommended" display/filter —
  // never triggers a new search or affects who Prospeo returns.
  recommendedRoles?: string[]
}>(function DecisionMakerFinder({
  companyName,
  domain,
  sourceRunId,
  onContactAdded,
  autoStart = false,
  compact = false,
  onSelectionChange,
  onDiscoveryComplete,
  leadershipContacts,
  analysisResult,
  recommendedRoles,
}, ref) {
  const [roleCategoryFilter, setRoleCategoryFilter] = useState<'all' | RoleCategory>('all')
  const [showAllCandidates, setShowAllCandidates] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [candidates, setCandidates] = useState<DecisionMakerCandidate[]>([])
  const [candidatesProvider, setCandidatesProvider] = useState<string | null>(null)
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set())
  const [targetTitlesInput, setTargetTitlesInput] = useState(DEFAULT_TARGET_TITLES.join(', '))
  const [adding, setAdding] = useState(false)
  const [hasAutoStarted, setHasAutoStarted] = useState(false)
  const [showTitlesInput, setShowTitlesInput] = useState(!compact)
  // Auto Flow's autoStart fires handleDiscover() the instant this component
  // mounts (once a cache lookup has confirmed there's nothing to restore),
  // no manual click or confirmation required — this is a deliberate product
  // decision (2026-07-31): the user explicitly asked for decision-maker
  // search to run automatically rather than waiting on a "Search" click,
  // reversing the 2026-07-19 confirm-dialog gate that used to sit here. That
  // gate existed because a real vendor (Prospeo) spends paid credits per
  // search — that cost is now accepted as the price of a fully automatic
  // flow rather than guarded per-run. If this needs to be revisited, the
  // isPaidProvider check + ConfirmDialog this replaced are in git history.
  // True once the initial cache lookup (below) has resolved either way —
  // gates the "Adjust titles"/candidate-list UI from flashing empty before
  // a cached search has had a chance to populate it.
  const [checkingCache, setCheckingCache] = useState(true)

  // Recommended title groups from this company's own research — pure,
  // synchronous, no network call. Falls back to a single group holding
  // DEFAULT_TARGET_TITLES with an honest "no specific signal" reason when
  // analysisResult is absent or nothing matched (see role-recommendation.ts).
  const recommendedGroups = useMemo(() => recommendTitlesFromResearch(analysisResult), [analysisResult])
  const hasRealRecommendation = recommendedGroups.some(g => g.fromResearch)

  // Merges role-recommendation.ts's research-derived titles with Sales
  // Intelligence's own recommended_roles (when available) into one set used
  // only to flag which already-returned candidates are "recommended" for
  // this specific opportunity — union, not override, since both are
  // legitimate independent signals and more data doesn't hurt here.
  const recommendedTitleSet = useMemo(() => {
    const fromGroups = recommendedGroups.filter(g => g.fromResearch).flatMap(g => g.titles)
    const fromSalesIntelligence = recommendedRoles ?? []
    return new Set([...fromGroups, ...fromSalesIntelligence].map(t => t.toLowerCase().trim()).filter(Boolean))
  }, [recommendedGroups, recommendedRoles])

  function isRecommendedCandidate(candidate: DecisionMakerCandidate): boolean {
    if (recommendedTitleSet.size === 0) return false
    const t = candidate.title.toLowerCase()
    return Array.from(recommendedTitleSet).some(rt => t.includes(rt) || rt.includes(t))
  }

  // Runs once on mount, regardless of autoStart: first checks for an
  // already-cached search for this run (migration 015) — a cache hit
  // restores the exact prior candidate list with nothing re-spent, and
  // skips auto-searching entirely. Only on a cache MISS does autoStart's
  // immediate search kick in. This replaces the old effect, which
  // unconditionally re-ran a real (often paid) search on every remount —
  // a page refresh, or navigating away from and back to this step — since
  // hasAutoStarted was only ever component-local state, never persisted.
  useEffect(() => {
    if (hasAutoStarted) return
    // One-time guard-flag pattern (hasAutoStarted itself prevents
    // re-firing), not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasAutoStarted(true)
    void (async () => {
      try {
        const cacheRes = await fetch(
          `/api/admin/outbound/decision-makers/discover?source_run_id=${encodeURIComponent(sourceRunId)}`
        )
        const cacheData = await cacheRes.json()
        if (cacheData.success && cacheData.cached) {
          const cached = cacheData.cached as {
            candidates: DecisionMakerCandidate[]
            providerUsed: string
            targetTitles: string[]
          }
          setCandidates(cached.candidates)
          setCandidatesProvider(cached.providerUsed)
          setSelectedCandidates(new Set(cached.candidates.map((_, i) => i)))
          if (cached.targetTitles?.length) setTargetTitlesInput(cached.targetTitles.join(', '))
          onDiscoveryComplete?.()
          return // cache hit — restored, nothing to search
        }
      } catch {
        // Cache lookup failing just means we fall through below, same as a
        // genuine cache miss.
      } finally {
        setCheckingCache(false)
      }

      if (!autoStart) {
        onDiscoveryComplete?.()
        return
      }
      void handleDiscover()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAutoStarted])

  async function handleDiscover() {
    const titles = targetTitlesInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
    setSelectedCandidates(new Set())
    setRoleCategoryFilter('all')
    setShowAllCandidates(false)
    setDiscovering(true)
    try {
      const res = await fetch('/api/admin/outbound/decision-makers/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          domain,
          targetTitles: titles.length ? titles : undefined,
          leadershipContacts: leadershipContacts?.length ? leadershipContacts : undefined,
          // Lets the route cache this result (migration 015) so a later
          // remount restores it instead of re-searching — see this
          // component's own mount effect above.
          sourceRunId,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Decision-maker discovery failed')
        return
      }
      const result = data.result as {
        candidates: DecisionMakerCandidate[]
        providerUsed: string
        status: 'found' | 'not_found' | 'error'
        reason?: string
      }
      setCandidates(result.candidates)
      setCandidatesProvider(result.providerUsed)
      // Pre-select everything found — "the user simply selects who they
      // want to contact" reads more naturally as "uncheck who you don't
      // want" than starting from an empty list every search.
      setSelectedCandidates(new Set(result.candidates.map((_, i) => i)))
      if (result.status === 'found') toast.success(`Found ${result.candidates.length} candidate(s)`)
      else toast.warning(result.reason ?? 'No candidates found')
    } catch {
      toast.error('Could not reach the decision-maker discovery API')
    } finally {
      setDiscovering(false)
      onDiscoveryComplete?.()
    }
  }

  function toggleCandidate(index: number) {
    setSelectedCandidates(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  // Everything found starts pre-selected (see handleDiscover above), so in
  // practice this is mostly used to deselect-all after unchecking a few by
  // hand, then re-select-all without clicking every row again.
  function toggleSelectAllCandidates() {
    setSelectedCandidates(prev =>
      prev.size === candidates.length ? new Set() : new Set(candidates.map((_, i) => i))
    )
  }

  useEffect(() => {
    onSelectionChange?.(selectedCandidates.size)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCandidates])

  async function handleAddSelected() {
    const toAdd = candidates.filter((_, i) => selectedCandidates.has(i))
    setAdding(true)
    try {
      for (const candidate of toAdd) {
        const res = await fetch('/api/admin/outbound/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_run_id: sourceRunId,
            company_domain: domain,
            company_name: companyName,
            person_name: candidate.personName,
            title_hint: candidate.title,
            linkedin_url: candidate.linkedinUrl,
            discovery_source: 'decision_maker_discovery',
            discovery_confidence: candidate.confidence,
            discovery_provider: candidatesProvider ?? undefined,
          }),
        })
        const data = await res.json()
        if (!data.success) {
          toast.error(data.error ?? `Failed to add ${candidate.personName}`)
          continue
        }
        onContactAdded(data.contact)
        toast.success(`Added ${candidate.personName}`)
      }
    } finally {
      setAdding(false)
      setSelectedCandidates(new Set())
    }
  }

  useImperativeHandle(ref, () => ({ commitSelected: handleAddSelected }))

  return (
    <Card className="border-border bg-card">
      <CardContent className="px-5 py-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Find Decision Makers</h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            {checkingCache
              ? 'Checking for a previously saved search…'
              : autoStart && compact
              ? 'Searching automatically using common titles (CEO, CTO, VP Operations, etc). Found candidates start checked below, uncheck anyone you don’t want, then hit Continue.'
              : autoStart
              ? 'Searching automatically using common titles (CEO, CTO, VP Operations, etc). Found candidates start checked below, uncheck anyone you don’t want, nothing is added until you confirm.'
              : 'Searches for candidate decision-makers by title. Found candidates start checked below, uncheck anyone you don’t want, nothing is added until you confirm.'}
          </p>
        </div>
        {checkingCache ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
            <Spinner className="size-3.5" /> Loading…
          </div>
        ) : (
        <>
        {hasRealRecommendation && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 space-y-1.5">
            <p className="text-xs font-medium text-foreground">Recommended for this company</p>
            {recommendedGroups.filter(g => g.fromResearch).map((group, i) => (
              <div key={i} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-foreground">{group.titles.join(', ')}</p>
                  <p className="text-[11px] text-muted-foreground/70">{group.reason}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    setTargetTitlesInput(group.titles.join(', '))
                    setShowTitlesInput(true)
                  }}
                >
                  Use these
                </Button>
              </div>
            ))}
          </div>
        )}
        {showTitlesInput ? (
          <div className="space-y-1">
            <Label htmlFor="target-titles">Target titles (comma-separated)</Label>
            <Input
              id="target-titles"
              value={targetTitlesInput}
              onChange={e => setTargetTitlesInput(e.target.value)}
              placeholder={DEFAULT_TARGET_TITLES.join(', ')}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowTitlesInput(true)}
            className="text-xs text-muted-foreground/70 underline hover:text-foreground text-left"
          >
            Adjust titles
          </button>
        )}
        <Button size="sm" variant="outline" disabled={discovering} onClick={handleDiscover}>
          {discovering ? <Spinner className="size-3.5" /> : null}
          {autoStart && (candidates.length > 0 || discovering) ? 'Search Again' : 'Find Decision Makers'}
        </Button>

        {discovering && candidates.length === 0 && (
          <div className="pt-2 border-t border-border space-y-3">
            <StageProgress active={discovering} stages={DISCOVERY_STAGES} />
            <CandidateRowSkeletons />
          </div>
        )}

        {candidates.length > 0 && (() => {
          const recommendedCount = candidates.filter(isRecommendedCandidate).length
          const indexed = candidates.map((candidate, i) => ({ candidate, i }))
          const roleFiltered =
            roleCategoryFilter === 'all'
              ? indexed
              : indexed.filter(({ candidate }) => classifyRoleCategory(candidate.title) === roleCategoryFilter)
          // Defaults to recommended-only when any exist and the user hasn't
          // asked to see everything — today's behavior (show everything) is
          // preserved whenever nothing is recommended.
          const visible =
            recommendedCount > 0 && !showAllCandidates
              ? roleFiltered.filter(({ candidate }) => isRecommendedCandidate(candidate))
              : roleFiltered
          const categoriesPresent = Array.from(new Set(candidates.map(c => classifyRoleCategory(c.title))))

          return (
            <div className="pt-2 border-t border-border space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground/70">
                  {candidates.length} candidate{candidates.length === 1 ? '' : 's'} found
                  {recommendedCount > 0 && ` · ${recommendedCount} recommended`}
                </p>
                <div className="flex items-center gap-3">
                  {recommendedCount > 0 && recommendedCount < candidates.length && (
                    <button
                      type="button"
                      onClick={() => setShowAllCandidates(v => !v)}
                      className="text-xs text-muted-foreground/70 underline hover:text-foreground"
                    >
                      {showAllCandidates ? 'Show recommended only' : `View all ${candidates.length}`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleSelectAllCandidates}
                    className="text-xs text-muted-foreground/70 underline hover:text-foreground"
                  >
                    {selectedCandidates.size === candidates.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
              </div>

              {candidates.length > 6 && categoriesPresent.length > 1 && (
                <Select value={roleCategoryFilter} onValueChange={v => setRoleCategoryFilter(v as 'all' | RoleCategory)}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    {categoriesPresent.map(cat => (
                      <SelectItem key={cat} value={cat}>{ROLE_CATEGORY_LABELS[cat]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-2">
                {visible.map(({ candidate, i }) => (
                  <motion.label
                    key={`${candidate.title}-${i}`}
                    variants={listItem}
                    className="flex items-center gap-2.5 text-sm cursor-pointer flex-wrap"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCandidates.has(i)}
                      onChange={() => toggleCandidate(i)}
                      className="size-3.5"
                    />
                    <span className="text-foreground">{candidate.personName}</span>
                    <span className="text-xs text-muted-foreground/70">{candidate.title}</span>
                    <Badge variant={confidenceBadgeVariant(candidate.confidence)}>{candidate.confidence}</Badge>
                    {isRecommendedCandidate(candidate) && <Badge variant="default">Recommended</Badge>}
                    {candidate.grounding && (
                      <Badge
                        variant={groundingBadgeVariant(candidate.grounding.status)}
                        title={candidate.grounding.reason}
                      >
                        {groundingLabel(candidate.grounding.status)}
                      </Badge>
                    )}
                  </motion.label>
                ))}
              </motion.div>
              {compact ? (
                <p className="text-xs text-muted-foreground/70">
                  {selectedCandidates.size} selected. Hit Continue above to add {selectedCandidates.size === 1 ? 'them' : 'them all'} and move on.
                </p>
              ) : (
                <Button size="sm" disabled={adding || selectedCandidates.size === 0} onClick={handleAddSelected}>
                  {adding ? <Spinner className="size-3.5" /> : null}
                  Add Selected as Contacts ({selectedCandidates.size})
                </Button>
              )}
            </div>
          )
        })()}
        </>
        )}
      </CardContent>
    </Card>
  )
})

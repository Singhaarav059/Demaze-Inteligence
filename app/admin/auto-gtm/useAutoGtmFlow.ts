'use client'

// ============================================================
// useAutoGtmFlow — state + actions for the Auto Flow guided page
// ============================================================
// One prospect company, one continuous session: Research -> Contacts (auto
// decision-maker discovery + enrich) -> Email (auto-drafted outreach +
// send). Calls the same
// API routes every other page in this app already uses — no new backend
// logic, this hook only orchestrates existing ones across steps instead of
// losing state at a page boundary. Current step + runId sync to the URL
// query string so a mid-flow refresh resumes instead of starting over.
//
// Deliberately reads/writes the URL via window.location + router.replace()
// instead of next/navigation's useSearchParams() — that hook requires
// wrapping the page in <Suspense>, which reproduced a real, page-specific
// Next.js 16 dev/Turbopack bug here (the Suspense streaming "reveal" script
// never ran, leaving the whole page's real content permanently stuck inside
// a hidden `<div id="S:0" style="display:none">` server-streaming
// placeholder — confirmed via direct DOM inspection, reproducible on a
// fresh browser session, and confirmed absent on every other page in this
// app that doesn't use useSearchParams()). The initial state always matches
// SSR output (step 1, no runId) to avoid any hydration mismatch; the actual
// URL is read client-side in an effect after mount, same "client-only
// concern, hydrate after mount" pattern already used by resumeFromRun.
//
// RECURRED 2026-07-19 via a different trigger: adding app/admin/loading.tsx
// (a route-transition loading shell, unrelated to this file) broke this
// page the same way, because Next.js App Router automatically wraps a
// loading.tsx's whole route subtree in <Suspense> — same underlying
// Turbopack bug, different source of the Suspense boundary. Fixed by
// removing that file rather than by touching this one. See CLAUDE.md's
// Track 2 entry for the full repro. Moral: ANY Suspense boundary anywhere
// above this page in the tree can retrigger this — not just
// useSearchParams().
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { RunResult, AnalysisMode } from '@/app/admin/intelligence-lab/_types'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'
import type { DedupedCompany } from '@/lib/batch/company-dedup'
import type { DecisionMakerCandidate } from '@/lib/outbound/decision-maker-discovery/types'
import { quotaSignatureIn, nextConsecutiveHits, shouldPauseBatch, QUOTA_PAUSE_THRESHOLD } from '@/lib/batch/quota-pause'
import { qualifyCompany } from '@/lib/sector-playbook/qualify'
import { getResearchQuality } from '@/lib/pipeline/analysis-sections'

export type FlowStep = 1 | 2 | 3 | 4 | 5 | 6
export type InputMode = 'single' | 'batch'
export type BatchCompanyStatus = 'pending' | 'researching' | 'discovering' | 'done' | 'failed'
type ContactActionKind = 'find-email' | 'delete'
interface SendOutcomeDetail {
  // 'ambiguous' (Phase A) / 'blocked' (Phase B) match the real outcome
  // statuses send/route.ts can now return — both fall through to the
  // generic toast.warning(reason) branch below, same as 'failed'/'skipped'.
  status: 'sent' | 'skipped' | 'failed' | 'ambiguous' | 'blocked'
  reason?: string
}

export interface BatchCompanyState {
  company: DedupedCompany
  selected: boolean
  status: BatchCompanyStatus
  runId?: string
  contactsFound: number
  errorMessage?: string
}

export function deriveCompanyName(domain: string, analysisResult: Record<string, unknown> | undefined): string {
  const fromResult = analysisResult?.company_name
  if (typeof fromResult === 'string' && fromResult.trim()) return fromResult
  return domain
    .replace(/\.[a-z]+$/i, '')
    .split(/[.-]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function useAutoGtmFlow() {
  const router = useRouter()

  const [step, setStepState] = useState<FlowStep>(1)
  // Flips true once the URL has been read client-side (see the effect
  // below). page.tsx doesn't mount its AnimatePresence-wrapped step content
  // until this is true, specifically so a resumed run (`?step=4&runId=...`)
  // never even briefly mounts step 1's content — see that effect's own
  // comment for why a naive fix (useLayoutEffect) made this worse, not better.
  const [stepSynced, setStepSynced] = useState(false)
  // Highest step this session has ever reached — drives which StepIndicator
  // pills are clickable. Only ever increases; going "back" via setStep()
  // does not shrink it, so the flow can always jump forward again too.
  const [maxStepReached, setMaxStepReached] = useState<FlowStep>(1)
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<AnalysisMode>('full')
  const [researching, setResearching] = useState(false)
  // Set only while a force-fresh (clear-cache) research call is in flight —
  // purely a label flag for the "Clear Cache & Re-Research" button below,
  // same "researching" state otherwise drives both buttons' disabled state.
  const [forcingFresh, setForcingFresh] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [contacts, setContacts] = useState<OutboundContact[]>([])
  const [pendingAction, setPendingAction] = useState<Record<string, ContactActionKind | undefined>>({})
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [sendingContactId, setSendingContactId] = useState<string | null>(null)
  const [sendingSelected, setSendingSelected] = useState(false)
  const [campaignContactStatus, setCampaignContactStatus] = useState<Record<string, SendOutcomeDetail>>({})
  // Was hardcoded '(mock)' in every send toast regardless of the actually-
  // active sending provider — misleading once a real vendor (e.g. Gmail) is
  // connected. Same fetch-and-check pattern as OutreachStep's own badge.
  const [sendingProviderName, setSendingProviderName] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void (async () => {
      try {
        const res = await fetch('/api/admin/outbound/integrations')
        const data = await res.json()
        if (!data.success) return
        const sendingRow = (data.integrations as Array<{ capability: string; provider_name: string; is_active: boolean }>).find(
          row => row.capability === 'sending' && row.is_active
        )
        setSendingProviderName(sendingRow?.provider_name ?? 'mock')
      } catch {
        setSendingProviderName('mock')
      }
    })()
  }, [])

  // ── Batch upload mode ─────────────────────────────────────────
  const [inputMode, setInputMode] = useState<InputMode>('single')
  const [batchCompanies, setBatchCompanies] = useState<BatchCompanyState[]>([])
  const [batchUploading, setBatchUploading] = useState(false)
  const [batchUploadError, setBatchUploadError] = useState<string | null>(null)
  const [batchUploadWarnings, setBatchUploadWarnings] = useState<string[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [batchPausedReason, setBatchPausedReason] = useState<string | null>(null)
  const batchStopRequested = useRef(false)

  function setStep(next: FlowStep) {
    setStepState(next)
    setMaxStepReached(prev => (next > prev ? next : prev))
    const params = new URLSearchParams(window.location.search)
    params.set('step', String(next))
    if (runId) params.set('runId', runId)
    router.replace(`/admin/auto-gtm?${params.toString()}`)
  }

  // Explicit "start over" — the URL carries step/runId by design so a
  // mid-flow refresh resumes (see file header), which means a dev-server
  // restart alone never clears it either (that's a client-side browser
  // concern, not a server one). This is the one deliberate way to actually
  // clear it: wipes every piece of in-progress state back to the initial
  // values and drops the URL back to bare /admin/auto-gtm.
  const resetFlow = useCallback(() => {
    setStepState(1)
    setMaxStepReached(1)
    setUrl('')
    setMode('full')
    setResearching(false)
    setForcingFresh(false)
    setResult(null)
    setError(null)
    setRunId(null)
    setContacts([])
    setPendingAction({})
    setCampaignId(null)
    setSendingContactId(null)
    setSendingSelected(false)
    setCampaignContactStatus({})
    setInputMode('single')
    setBatchCompanies([])
    setBatchUploadError(null)
    setBatchUploadWarnings([])
    setBatchRunning(false)
    setBatchProgress(null)
    setBatchPausedReason(null)
    router.replace('/admin/auto-gtm')
  }, [router])

  // Reloads contacts + campaign/send state for a given run id — extracted
  // out of resumeFromRun (2026-08-10) so runResearch() can reuse the exact
  // same restoration logic when re-researching a domain that already has a
  // tracked pipeline entry, WITHOUT also overwriting result/url/runId the
  // way a full resumeFromRun() would (runResearch already has fresher
  // versions of those from the analysis call that just completed).
  const restoreContactsAndCampaign = useCallback(async (id: string) => {
    const contactsRes = await fetch(`/api/admin/outbound/contacts?source_run_id=${id}`)
    const contactsData = await contactsRes.json()
    let resumedContactIds: string[] = []
    if (contactsData.success) {
      setContacts(contactsData.contacts)
      resumedContactIds = (contactsData.contacts as Array<{ id: string }>).map(c => c.id)
      // Contacts already exist for this run, so decision-maker selection
      // (step 2) is already done — unlock at least step 3 (Contact Info)
      // regardless of which step the URL opened at (e.g. a Resume link from
      // Run History always opens at step 2, since History has no cheap way
      // to know how far a given run actually got without fetching this same
      // data). This only ever widens which StepIndicator pills are
      // clickable — it never changes which step's content is shown first.
      if (contactsData.contacts.length > 0) {
        setMaxStepReached(prev => (prev < 3 ? 3 : prev))
      }
    }

    // Restore campaign/send state too (2026-07-19 fix) — without this, a
    // mid-flow refresh at the Outreach & Send step loses campaignId, and
    // ensureCampaignId() would then create a BRAND NEW campaign on the
    // next Send click. Since send status is scoped per-campaign, that new
    // campaign's contacts all start 'queued' again — re-sending to
    // contacts that were already sent under the original campaign.
    //
    // FIXED (2026-08-05): this used to look up
    // `?source_run_id=${id}` against outbound_campaigns — works for a
    // single-company campaign (which has source_run_id set), but silently
    // finds NOTHING for a batch-originated company, since batch mode
    // creates one SHARED campaign for the whole batch with
    // source_run_id: null. That meant resuming into a batch-originated
    // company never restored campaignId/campaignContactStatus at all —
    // already-sent contacts would show as unsent, and clicking Send again
    // would create a genuinely duplicate campaign for contacts that
    // already had one. Fixed by looking up the campaign via THIS
    // company's own contacts instead (?contact_ids=...,  a new filter on
    // the same route) — outbound_contacts.source_run_id is reliably set
    // per-company for both single and batch-created contacts, and any of
    // those contacts' own outbound_campaign_contacts.campaign_id points at
    // whichever campaign (dedicated or shared) they were actually
    // enqueued into. Works identically for both cases; source_run_id is no
    // longer used here at all.
    const existingCampaign = resumedContactIds.length > 0
      ? await (async () => {
          const campaignsRes = await fetch(`/api/admin/outbound/campaigns?contact_ids=${resumedContactIds.join(',')}`)
          const campaignsData = await campaignsRes.json()
          return campaignsData.success ? campaignsData.campaigns?.[0] : null
        })()
      : null
    if (existingCampaign) {
      // FIXED (2026-08-12, 6-step restructure): a campaign row is now
      // created EARLY — the moment step 4 (Campaign & Outreach) is opened,
      // by CampaignSettingsPanel's ensureCampaignId() call, so settings have
      // something real to save against before any send happens. That means
      // the campaign existing no longer implies a send was ever attempted
      // (it used to, back when ensureCampaignId() was only ever called
      // lazily from the send action itself) — so this now checks whether
      // any contact was actually ENQUEUED (a real signal Review & Send's
      // "Confirm & Send" writes, campaign settings alone never do) before
      // deciding how far to widen maxStepReached.
      setCampaignId(existingCampaign.id)
      const campaignContactsRes = await fetch(`/api/admin/outbound/campaigns/${existingCampaign.id}/contacts`)
      const campaignContactsData = await campaignContactsRes.json()
      if (campaignContactsData.success) {
        const rows = campaignContactsData.contacts as Array<{ contact_id: string; status: string }>
        if (rows.length > 0) {
          // At least one contact was enqueued — Review & Send ran at least
          // once, so Track & Follow Up (step 6) is a valid landing spot too.
          setMaxStepReached(prev => (prev < 6 ? 6 : prev))
        } else {
          // Campaign settings were opened/saved but nothing was ever
          // enqueued to send — only Review & Send (step 5) is reachable,
          // not Track & Follow Up (it would just show "nothing sent yet").
          setMaxStepReached(prev => (prev < 5 ? 5 : prev))
        }
        const restored: Record<string, SendOutcomeDetail> = {}
        for (const row of rows) {
          // 'queued' means never sent (or skipped/failed and still
          // retry-eligible) — leave it absent so the contact still shows
          // as sendable. Anything past 'queued' means it went out.
          if (row.status !== 'queued') restored[row.contact_id] = { status: 'sent' }
        }
        setCampaignContactStatus(restored)
      }
    }
  }, [])

  // True while any of restoreContactsAndCampaign()'s callers are still
  // mid-flight — resumeFromRun() (regardless of which caller triggered it:
  // the URL-driven mount-time resume, or CompanyPipelineList's "Resume"
  // button), AND runResearch()'s own re-research-an-existing-run branch
  // (added later, same race). Exists to close a real race found live
  // (2026-08-12): CampaignSettingsPanel eagerly calls ensureCampaignId() the
  // moment it mounts (needed so campaign settings have something real to
  // save against before any send happens) — but campaignId can still be
  // null in local state well after a resumed run's REAL existing campaign
  // has already been restored server-side, right up until
  // restoreContactsAndCampaign's own fetches finish. Without this gate,
  // ensureCampaignId() would create a genuinely duplicate, orphaned campaign
  // (confirmed live TWICE while building this fix — first via the URL-mount
  // path, then again via this exact button — both times two rows named
  // " - Auto Flow" with no source_run_id).
  //
  // SAME RACE, SECOND VICTIM, found live again later (audit follow-up): the
  // Decision Makers auto-pilot commit effect in page.tsx (step 2 -> 3) has
  // its own `flow.contacts.length === 0` check gating whether to
  // auto-commit found candidates as contacts — reading that BEFORE
  // restoreContactsAndCampaign's contacts fetch resolves gives a false
  // "nothing exists yet" and auto-commits real duplicates. Confirmed live:
  // created 25 duplicate/unreviewed contacts for a real run once the
  // decision-maker search cache started actually working (P1 fix) made
  // DecisionMakerFinder's own cache-restore resolve fast enough to win this
  // race consistently — previously a real several-second Prospeo search
  // gave this fetch enough of a head start that the race rarely fired.
  // page.tsx's effect now also gates on `!resuming`, same flag, same fix
  // shape as the ensureCampaignId case above.
  //
  // Set as the very first line of resumeFromRun (not just in whichever
  // effect happens to call it) and around runResearch's re-research branch
  // specifically so every call path is covered, not only the one a given
  // bug was first noticed on.
  const [resuming, setResuming] = useState(false)

  const resumeFromRun = useCallback(async (id: string) => {
    setResuming(true)
    try {
      // Fetch this one run directly by id — NOT the `?limit=50` list route.
      // FIXED (2026-08-10): this used to fetch the 50 most-recent runs and
      // find() this id client-side, so resuming into any run older than the
      // most recent 50 silently failed (the try/catch below swallowed it,
      // leaving the flow stuck at step 1 with no error shown — "Resume is
      // best-effort" was masking a real bug, not just genuine unavailability).
      // The dedicated detail route already exists (used by run-history's own
      // "View Report" action) and returns the exact same row shape this
      // function needs, with no count cap at all.
      const res = await fetch(`/api/admin/test-runs/${id}`)
      const data = await res.json()
      if (!data.success) return
      const run = data.run as { id: string; domain: string; company_url: string; final_result?: Record<string, unknown> }
      if (!run) return
      setRunId(run.id)
      setUrl(run.company_url)
      setResult({ success: true, domain: run.domain, analysisResult: run.final_result })
      // Resuming always presents a focused, single-company view of this one
      // run — regardless of whether it was originally researched solo or as
      // part of a larger batch (batch's own progress state is pure React
      // state, never persisted, so there's nothing to reconstruct there
      // anyway; see restoreContactsAndCampaign's own campaign-lookup comment
      // for the related batch-campaign fix).
      setInputMode('single')
      await restoreContactsAndCampaign(run.id)
    } catch {
      // Resume is best-effort — a failed resume just leaves the flow at step 1.
    } finally {
      setResuming(false)
    }
  }, [restoreContactsAndCampaign])

  // Resume from a saved run if the URL already has one (e.g. mid-flow refresh).
  // Read client-side only, after mount — see the file header for why this
  // avoids next/navigation's useSearchParams()/<Suspense>.
  //
  // stepSynced (2026-07-19, Phase A motion pass): the step-content block in
  // page.tsx now animates transitions via AnimatePresence keyed on `step`.
  // A naive fix tried useLayoutEffect here to correct `step` before the
  // browser's first paint (avoiding a visible step-1-content-flashes-then-
  // corrects flicker on every resumed run) — that made things WORSE, not
  // better: changing the AnimatePresence key inside a pre-paint layout
  // effect gave framer-motion no real frame to animate from, and its exit
  // transition got permanently stuck, leaving step 1's markup stuck on
  // screen forever even though the StepIndicator pills (outside
  // AnimatePresence) correctly showed the resumed step. Reverted to a plain
  // useEffect (safe, standard timing) and fixed the flicker a different
  // way instead: page.tsx doesn't mount the AnimatePresence step-content
  // block at all until `stepSynced` is true, so a resumed run's step-1
  // content is never mounted in the first place — nothing to flicker away
  // from, and no key transition for AnimatePresence to get stuck on.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const resumeRunId = params.get('runId')
    const resumeStep = Number(params.get('step'))
    if (resumeStep >= 1 && resumeStep <= 6) {
      // One-time client-only URL-sync on mount, not a derived-state anti-pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStepState(resumeStep as FlowStep)
      setMaxStepReached(resumeStep as FlowStep)
    }
    setStepSynced(true)
    // resumeFromRun sets `resuming` itself (as its first line, before any
    // await) — no need to set it here too; see that function's own comment.
    if (resumeRunId) void resumeFromRun(resumeRunId)
  }, [resumeFromRun])

  const companyName = result?.domain ? deriveCompanyName(result.domain, result.analysisResult) : ''
  const domain = result?.domain ?? ''

  // DRAFT sector-playbook qualification (lib/sector-playbook) — pure, sync,
  // no network call, so this is just a memoized derivation over whatever
  // research/contacts are already loaded, recomputed as decision-maker
  // discovery adds contacts (contactability score improves with real data
  // instead of staying "not yet determined").
  const qualification = useMemo(
    () =>
      result?.analysisResult
        ? qualifyCompany(result.analysisResult, {
            // Only pass a real count once at least one contact exists —
            // contacts.length === 0 is ambiguous between "discovery hasn't
            // run yet" and "ran, found nobody," and qualify.ts treats those
            // very differently (null/"not yet determined" vs. a real low
            // score). Understating a genuine zero-found case is the safer
            // default here, not fabricating a score before the step runs.
            decisionMakerCount: contacts.length > 0 ? contacts.length : undefined,
          })
        : null,
    [result?.analysisResult, contacts.length]
  )

  // Master Plan Phase 5, Step 5.5 (confidence gate) — reuses
  // auditResearchQuality()'s existing, already-computed output (see
  // lib/pipeline/research-quality.ts) rather than duplicating its logic.
  // That function itself stays purely informational; this is just the
  // send-time surface for its output. Null (not 0) when no research is
  // loaded yet, so ReviewSendStep can tell "nothing to check" apart from
  // "checked, zero flags."
  const researchQualityFlagged = useMemo(
    () =>
      result?.analysisResult
        ? getResearchQuality(result.analysisResult)?.items_flagged ?? 0
        : null,
    [result?.analysisResult]
  )

  // opts.force clears any cached scrape for this URL server-side and
  // researches fresh — the one-button "clear cache & rescrape" option
  // rendered next to Research on Step 1. Normal Research (force omitted)
  // reuses a cached scrape when one exists, same as before.
  const runResearch = useCallback(async (opts: { force?: boolean } = {}) => {
    const urlNormalized = url.trim()
    if (!urlNormalized) return
    setResearching(true)
    setForcingFresh(Boolean(opts.force))
    setError(null)
    setResult(null)
    // Starting a fresh research call means a new company (single mode is
    // strictly one company at a time) — clear anything left over from a
    // prior company in this same session so it doesn't bleed into the new
    // one (mixed-company contact list, a stale disabled Campaign button, etc).
    setContacts([])
    setCampaignId(null)
    setCampaignContactStatus({})
    setPendingAction({})
    setRunId(null)
    try {
      const res = await fetch('/api/admin/test-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlNormalized, mode, force: Boolean(opts.force) }),
      })
      const data: RunResult = await res.json()
      setResult(data)
      if (!data.success) {
        setError(data.error ?? 'Analysis failed')
        return
      }

      // Before saving, check whether this domain already has a tracked
      // pipeline entry (contacts/a campaign attached — the exact set
      // /api/admin/outbound/pipeline surfaces as "Sent Companies" on this
      // page). FIXED (2026-08-10): every research call used to unconditionally
      // insert a brand-new pipeline_test_runs row, so re-researching a
      // company you'd already sent to left a second, disconnected entry
      // behind in that list — same domain, same company, no relation to the
      // original run's contacts/campaign. If a match is found, that SAME
      // run is updated in place (PATCH) instead of inserting a new one; a
      // domain with no existing pipeline entry (first-time research, or a
      // company that never got past decision-maker discovery) still gets a
      // fresh row exactly as before.
      let existingRunId: string | null = null
      if (data.domain) {
        try {
          const pipelineRes = await fetch(`/api/admin/outbound/pipeline?domain=${encodeURIComponent(data.domain)}`)
          const pipelineData = await pipelineRes.json()
          if (pipelineData.success && pipelineData.companies?.length > 0) {
            existingRunId = pipelineData.companies[0].runId
          }
        } catch {
          // Best-effort — falls through to the normal insert path below.
        }
      }

      const runPayload = {
        company_url: urlNormalized,
        domain: data.domain,
        operation: 'analysis',
        status: 'completed',
        scraped_pages: data.scrapeResult?.successfulUrls.length ?? 0,
        failed_pages: data.scrapeResult?.failedUrls.length ?? 0,
        quality_score: data.quality?.score ?? 0,
        quality_note: data.quality?.note,
        token_usage: data.aiMeta?.tokensUsed ?? 0,
        provider_used: data.aiMeta?.provider,
        model_used: data.aiMeta?.model,
        ai_latency_ms: data.aiMeta?.latencyMs,
        execution_time_ms: data.executionTimeMs,
        scrape_time_ms: data.scrapeTimeMs,
        analysis_time_ms: data.analysisTimeMs,
        discovery_method: data.scrapeResult?.discoveryMethod,
        website_discovery: data.websiteDiscovery ?? null,
        scrape_result: data.scrapeResult,
        final_result: data.analysisResult,
        prompts: data.prompts,
        error_message: data.error,
      }

      const saveRes = existingRunId
        ? await fetch(`/api/admin/test-runs/${existingRunId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(runPayload),
          })
        : await fetch('/api/admin/test-runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(runPayload),
          })
      const saveData = await saveRes.json()
      if (saveData.success) {
        const resolvedRunId = existingRunId ?? saveData.id
        // Land on step 1 with the result visible — page.tsx's auto-pilot
        // effect (2026-08-13) watches `hasResearch` and advances to step 2
        // itself once this result lands, so this no longer needs to wait
        // for a manual Continue click; the ResearchCard is still briefly on
        // screen and reachable again afterward via the step 1 pill.
        setRunId(resolvedRunId)
        const params = new URLSearchParams()
        params.set('step', '1')
        params.set('runId', resolvedRunId)
        router.replace(`/admin/auto-gtm?${params.toString()}`)
        if (existingRunId) {
          // Re-researching a company already in the pipeline — reload its
          // existing contacts/campaign state so decision-maker discovery
          // (step 2) doesn't re-run from scratch and create duplicate
          // outbound_contacts rows for people already found under this run.
          //
          // FIXED (audit follow-up, live-caught): setRunId() above already
          // fired, so page.tsx's auto-pilot can advance to step 2 and mount
          // DecisionMakerFinder while flow.contacts is still stale/empty —
          // if its own cache-restore resolves fast (a real risk once the
          // decision-maker search cache actually works — see the P1 fix
          // this follows), the step2->3 effect's `flow.contacts.length ===
          // 0` check reads that stale emptiness as "nothing exists yet" and
          // auto-commits every cached candidate as a genuine duplicate.
          // Confirmed live: this exact race created 25 duplicate/unreviewed
          // contacts for a real run during verification. `resuming` (see
          // resumeFromRun below, the flag this same class of race was
          // already fixed with once for ensureCampaignId) now also gates
          // that effect — set here too so this second call site gets the
          // same protection, not just the URL/Resume-button path.
          setResuming(true)
          try {
            await restoreContactsAndCampaign(existingRunId)
          } finally {
            setResuming(false)
          }
        }
      } else {
        // Every later step needs a saved runId to attach contacts/decision-
        // makers to (a contact's source_run_id is a UUID column; there's
        // nothing valid to send it without one).
        setError('Research completed but could not be saved to run history, so decision-maker discovery cannot continue. Try again.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setResearching(false)
    }
  }, [url, mode, router, restoreContactsAndCampaign])

  const addContactRow = useCallback((contact: OutboundContact) => {
    setContacts(prev => [contact, ...prev])
  }, [])

  // ── Batch upload: parse + dedupe (reuses lib/batch/*, same as Wizard) ──

  async function handleBatchFile(file: File) {
    setBatchUploading(true)
    setBatchUploadError(null)
    setBatchUploadWarnings([])
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/batch-parse', { method: 'POST', body: formData })
      const data = await res.json()

      if (!data.success) {
        setBatchUploadError(data.error ?? 'Failed to parse file')
        return
      }

      setBatchUploadWarnings(data.warnings ?? [])
      setBatchCompanies(
        // Excel/CSV uploads share the same company_registry identity system
        // as automatic discovery (governing plan, "no separate dedup system
        // for uploads") — batch-parse annotates each row with
        // existingStatus. A row already 'researched'/'outreached' defaults
        // to UNselected, same "checkbox is the manual override" discipline
        // as the Discover page.
        (data.companies as DedupedCompany[]).map(company => ({
          company,
          selected: company.existingStatus !== 'researched' && company.existingStatus !== 'outreached',
          status: 'pending' as BatchCompanyStatus,
          contactsFound: 0,
        }))
      )
    } catch (e) {
      setBatchUploadError(e instanceof Error ? e.message : 'Network error while uploading')
    } finally {
      setBatchUploading(false)
    }
  }

  function toggleBatchCompany(id: string) {
    setBatchCompanies(prev => prev.map(c => (c.company.id === id ? { ...c, selected: !c.selected } : c)))
  }
  function selectAllBatch() {
    setBatchCompanies(prev => prev.map(c => ({ ...c, selected: true })))
  }
  function selectNoneBatch() {
    setBatchCompanies(prev => prev.map(c => ({ ...c, selected: false })))
  }
  function updateBatchCompany(id: string, patch: Partial<BatchCompanyState>) {
    setBatchCompanies(prev => prev.map(c => (c.company.id === id ? { ...c, ...patch } : c)))
  }
  function stopBatch() {
    batchStopRequested.current = true
  }

  // ── Batch upload: sequential research -> auto decision-maker discovery,
  // one company at a time (same "sequential by design" discipline as
  // Wizard's researchSelected() — quota-bound, not a UX preference). Every
  // found candidate is auto-added as a contact (the review checkpoint is
  // AFTER discovery, not per-candidate during the batch) so the user can
  // review the whole batch's contacts together in steps 3-5. ──

  async function runBatchThroughDecisionMakers() {
    const queue = batchCompanies.filter(c => c.selected && c.status !== 'done')
    if (queue.length === 0) return

    setBatchRunning(true)
    setBatchPausedReason(null)
    batchStopRequested.current = false

    let consecutiveQuotaHits = 0

    for (let i = 0; i < queue.length; i++) {
      if (batchStopRequested.current) break

      const item = queue[i]
      setBatchProgress({ done: i, total: queue.length, current: item.company.companyName })
      updateBatchCompany(item.company.id, { status: 'researching' })

      try {
        const body = item.company.companyWebsite
          ? { url: item.company.companyWebsite, mode: 'full' }
          : { companyName: item.company.companyName, mode: 'full' }

        const res = await fetch('/api/admin/test-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data: RunResult = await res.json()

        if (!data.success) {
          updateBatchCompany(item.company.id, { status: 'failed', errorMessage: data.error ?? 'Research failed' })
        } else {
          const saveRes = await fetch('/api/admin/test-runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_url: item.company.companyWebsite ?? item.company.companyName,
              domain: data.domain,
              operation: 'full_pipeline',
              status: 'completed',
              scraped_pages: data.scrapeResult?.successfulUrls.length ?? 0,
              failed_pages: data.scrapeResult?.failedUrls.length ?? 0,
              quality_score: data.quality?.score ?? 0,
              quality_note: data.quality?.note,
              token_usage: data.aiMeta?.tokensUsed ?? 0,
              provider_used: data.aiMeta?.provider,
              model_used: data.aiMeta?.model,
              ai_latency_ms: data.aiMeta?.latencyMs,
              execution_time_ms: data.executionTimeMs,
              scrape_time_ms: data.scrapeTimeMs,
              analysis_time_ms: data.analysisTimeMs,
              discovery_method: data.scrapeResult?.discoveryMethod,
              website_discovery: data.websiteDiscovery ?? null,
              scrape_result: data.scrapeResult,
              final_result: data.analysisResult,
              prompts: data.prompts,
              error_message: data.error,
            }),
          })
          const saveData = await saveRes.json()
          const savedRunId: string | undefined = saveData.success ? saveData.id : undefined

          updateBatchCompany(item.company.id, { status: 'discovering', runId: savedRunId })

          const resolvedCompanyName =
            (typeof data.analysisResult?.company_name === 'string' && data.analysisResult.company_name.trim()) ||
            item.company.companyName
          const resolvedDomain = data.domain ?? ''

          if (resolvedDomain && savedRunId) {
            // Discovery + per-candidate persistence are isolated from the
            // outer catch on purpose: research (the expensive, quota-bound
            // step) already succeeded, so a network hiccup finding/adding
            // decision-makers should not mark this company 'failed' — that
            // would re-queue it for retry, re-running research for nothing
            // and re-adding any candidates that already persisted fine,
            // since outbound_contacts has no uniqueness constraint to guard
            // against duplicates.
            let contactsFound = 0
            try {
              const discoverRes = await fetch('/api/admin/outbound/decision-makers/discover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  companyName: resolvedCompanyName,
                  domain: resolvedDomain,
                  // Grounding input (2026-07-18 fix) — the company's own
                  // already-extracted leadership evidence from this same
                  // research call, so a batch-mode vendor candidate gets the
                  // same website cross-check single-mode gets via
                  // DecisionMakerFinder's leadershipContacts prop.
                  leadershipContacts: data.extractorResult?.leadershipContacts?.length
                    ? data.extractorResult.leadershipContacts
                    : undefined,
                }),
              })
              const discoverData = await discoverRes.json()

              if (discoverData.success && discoverData.result?.status === 'found') {
                const candidates: DecisionMakerCandidate[] = discoverData.result.candidates ?? []
                for (const candidate of candidates) {
                  try {
                    const addRes = await fetch('/api/admin/outbound/contacts', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        source_run_id: savedRunId,
                        company_domain: resolvedDomain,
                        company_name: resolvedCompanyName,
                        person_name: candidate.personName,
                        title_hint: candidate.title,
                        discovery_source: 'decision_maker_discovery',
                        discovery_confidence: candidate.confidence,
                        discovery_provider: discoverData.result.providerUsed,
                        discovery_grounding_status: candidate.grounding?.status,
                        discovery_grounding_reason: candidate.grounding?.reason,
                      }),
                    })
                    const addData = await addRes.json()
                    if (addData.success) {
                      addContactRow(addData.contact)
                      contactsFound++
                    }
                  } catch {
                    // One candidate failing to persist shouldn't lose the
                    // others already added, or fail the whole company.
                  }
                }
              }
            } catch {
              // Discovery itself failing just means 0 contacts for this
              // company — research still succeeded, so it's still 'done'.
            }
            updateBatchCompany(item.company.id, { status: 'done', contactsFound })
          } else {
            updateBatchCompany(item.company.id, { status: 'done', contactsFound: 0 })
          }
        }

        const quotaMsg = quotaSignatureIn(data)
        consecutiveQuotaHits = nextConsecutiveHits(consecutiveQuotaHits, quotaMsg)
        if (quotaMsg && shouldPauseBatch(consecutiveQuotaHits)) {
          setBatchPausedReason(
            `Stopped at company ${i + 1} of ${queue.length}, quota likely exhausted (${QUOTA_PAUSE_THRESHOLD} consecutive companies hit the same provider limit): "${quotaMsg}". Already-completed results below are saved.`
          )
          break
        }
      } catch (e) {
        updateBatchCompany(item.company.id, {
          status: 'failed',
          errorMessage: e instanceof Error ? e.message : 'Network error',
        })
      }
    }

    setBatchRunning(false)
    setBatchProgress(null)
  }

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

  // Outreach & Send's last-moment recipient-email edit — the auto-found
  // email isn't always the one the user wants to send to. Returns
  // true/false so the caller (OutreachStep) knows whether to also save its
  // draft edits.
  const updateContactEmail = useCallback(async (contactId: string, email: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to update email')
        return false
      }
      setContacts(prev => prev.map(c => (c.id === contactId ? data.contact : c)))
      return true
    } catch {
      toast.error('Could not reach the contacts API')
      return false
    }
  }, [])

  // Lazily creates the underlying campaign the first time anything is sent
  // — "campaign" is deliberately never surfaced as a concept in the guided
  // flow's UI/copy, it's just the existing sending infrastructure this hook
  // drives under the hood, same as before.
  //
  // FIXED (2026-08-12): found live, TWICE, two different root causes, both
  // producing real duplicate orphaned campaigns:
  //   1. A resumed run calling this before restoreContactsAndCampaign had
  //      restored the run's REAL existing campaignId (closed by the
  //      `resuming` gate in CampaignSettingsPanel, see that state's comment).
  //   2. This function itself has no protection against being called TWICE
  //      concurrently — confirmed live: on a genuinely fresh (non-resumed)
  //      step 4 mount, React StrictMode's dev-mode double-effect-invocation
  //      called this function twice in the same tick, both readings of
  //      `campaignId` were still null (neither POST had resolved yet), and
  //      two real campaigns got created for the same run, ~9ms apart.
  // Two independent guards now, since they close different gaps:
  //   (a) An in-flight-promise ref — a second concurrent call while a
  //       create is already pending awaits the SAME promise instead of
  //       firing a second POST. Closes the StrictMode double-invoke case.
  //   (b) A server-side existing-campaign check (by source_run_id, single
  //       mode only) before ever creating — closes any race where two calls
  //       happen far enough apart that (a) doesn't help (its promise has
  //       already resolved and cleared) but campaignId prop still hasn't
  //       propagated back to this specific caller yet.
  const ensureCampaignIdInFlight = useRef<Promise<string | null> | null>(null)

  const ensureCampaignId = useCallback(async (): Promise<string | null> => {
    if (campaignId) return campaignId
    if (ensureCampaignIdInFlight.current) return ensureCampaignIdInFlight.current

    const promise = (async (): Promise<string | null> => {
      try {
        if (inputMode === 'single' && runId) {
          try {
            const existingRes = await fetch(`/api/admin/outbound/campaigns?source_run_id=${runId}`)
            const existingData = await existingRes.json()
            const existing = existingData.success ? existingData.campaigns?.[0] : null
            if (existing) {
              setCampaignId(existing.id)
              return existing.id
            }
          } catch {
            // Falls through to create below — same fail-open discipline as
            // every other best-effort lookup in this file.
          }
        }

        const campaignName =
          inputMode === 'batch'
            ? `Batch (${batchCompanies.filter(c => c.status === 'done').length} companies) - Auto Flow`
            : `${companyName} - Auto Flow`
        const createRes = await fetch('/api/admin/outbound/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: campaignName, source_run_id: inputMode === 'batch' ? null : runId }),
        })
        const createData = await createRes.json()
        if (!createData.success) {
          toast.error(createData.error ?? 'Failed to prepare sending')
          return null
        }
        setCampaignId(createData.campaign.id)
        return createData.campaign.id
      } catch {
        toast.error('Could not reach the sending API')
        return null
      } finally {
        ensureCampaignIdInFlight.current = null
      }
    })()

    ensureCampaignIdInFlight.current = promise
    return promise
  }, [campaignId, inputMode, batchCompanies, companyName, runId])

  // Enqueues the given contact ids and sends whatever is queued — the send
  // route only ever touches rows still 'queued', so calling this repeatedly
  // (e.g. Send Email on one contact, then Send Selected on others later) is
  // safe and never double-sends. Shared by sendOneContact/
  // sendSelectedContacts, which differ only in which contact ids they pass.
  // Returns the outcome for each
  // requested contact id, resolved from the send response's
  // campaign-contact-row ids back to contact ids (the id space
  // campaignContactStatus is keyed by, matching every other piece of state).
  const enqueueAndSend = useCallback(
    async (contactIds: string[]): Promise<SendOutcomeDetail[]> => {
      const cId = await ensureCampaignId()
      if (!cId) return []

      // Wrapped in try/catch (2026-07-19 fix) — this makes 3 sequential
      // fetches with no error handling of its own; a network failure on any
      // of them used to become an unhandled promise rejection, silently
      // stopping the spinner with zero explanation to the user.
      try {
        const enqueueRes = await fetch(`/api/admin/outbound/campaigns/${cId}/contacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_ids: contactIds }),
        })
        const enqueueData = await enqueueRes.json()
        if (!enqueueData.success) {
          toast.error(enqueueData.error ?? 'Failed to prepare sending')
          return []
        }

        // contact_ids scopes this send to exactly the requested contacts —
        // see send/route.ts's 2026-07-28 fix. Without this, sendOneContact()
        // would fan out to every other still-queued contact in the campaign.
        const sendRes = await fetch(`/api/admin/outbound/campaigns/${cId}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_ids: contactIds }),
        })
        const sendData = await sendRes.json()
        if (!sendData.success) {
          toast.error(sendData.error ?? 'Send failed')
          return []
        }

        const contactsRes = await fetch(`/api/admin/outbound/campaigns/${cId}/contacts`)
        const contactsData = await contactsRes.json()
        const rowIdToContactId: Record<string, string> = {}
        if (contactsData.success) {
          for (const row of contactsData.contacts as Array<{ id: string; contact_id: string }>) {
            rowIdToContactId[row.id] = row.contact_id
          }
        }

        const outcomes: Array<{ campaignContactId: string; status: SendOutcomeDetail['status']; reason?: string }> =
          sendData.outcomes ?? []
        const deltaMap: Record<string, SendOutcomeDetail> = {}
        for (const outcome of outcomes) {
          const contactId = rowIdToContactId[outcome.campaignContactId]
          if (!contactId) continue
          deltaMap[contactId] = { status: outcome.status, reason: outcome.reason }
        }
        setCampaignContactStatus(prev => ({ ...prev, ...deltaMap }))

        return contactIds.map(id => deltaMap[id]).filter((d): d is SendOutcomeDetail => Boolean(d))
      } catch {
        toast.error('Could not reach the sending API')
        return []
      }
    },
    [ensureCampaignId]
  )

  const sendOneContact = useCallback(
    async (contactId: string) => {
      setSendingContactId(contactId)
      try {
        const [outcome] = await enqueueAndSend([contactId])
        if (!outcome) return
        if (outcome.status === 'sent') {
          toast.success(
            sendingProviderName && sendingProviderName !== 'mock'
              ? `Sent via ${sendingProviderName}`
              : 'Sent (mock), no real email leaves the app yet'
          )
        } else toast.warning(outcome.reason ?? `Could not send: ${outcome.status}`)
      } finally {
        setSendingContactId(null)
      }
    },
    [enqueueAndSend, sendingProviderName]
  )

  // Replaces the old "Send All" — Outreach & Send now defaults to nothing
  // selected and requires an explicit checkbox pick, so this always takes
  // an explicit contact-id list rather than reaching for every contact.
  const sendSelectedContacts = useCallback(async (contactIds: string[]) => {
    if (contactIds.length === 0) {
      toast.error('No contacts selected')
      return
    }
    setSendingSelected(true)
    try {
      const outcomes = await enqueueAndSend(contactIds)
      // An empty result here means enqueueAndSend already failed and shown
      // its own toast.error — showing "0 sent, 0 skipped, 0 failed" as a
      // success toast on top of that would be misleading (2026-07-19 fix).
      if (outcomes.length === 0) return
      const sent = outcomes.filter(o => o.status === 'sent').length
      const skipped = outcomes.filter(o => o.status === 'skipped').length
      const failed = outcomes.filter(o => o.status === 'failed').length
      const prefix = sendingProviderName && sendingProviderName !== 'mock' ? `Sent via ${sendingProviderName}` : 'Sent (mock)'
      toast.success(`${prefix}: ${sent} sent, ${skipped} skipped, ${failed} failed`)
    } finally {
      setSendingSelected(false)
    }
  }, [enqueueAndSend, sendingProviderName])

  return {
    step,
    stepSynced,
    setStep,
    resetFlow,
    maxStepReached,
    inputMode,
    setInputMode,
    url,
    setUrl,
    mode,
    setMode,
    researching,
    forcingFresh,
    result,
    error,
    runId,
    companyName,
    domain,
    qualification,
    researchQualityFlagged,
    runResearch,
    contacts,
    addContactRow,
    pendingAction,
    findEmailForContact,
    deleteContact,
    updateContactEmail,
    campaignId,
    ensureCampaignId,
    resuming,
    campaignContactStatus,
    sendingContactId,
    sendingSelected,
    sendOneContact,
    sendSelectedContacts,
    batchCompanies,
    batchUploading,
    batchUploadError,
    batchUploadWarnings,
    batchRunning,
    batchProgress,
    batchPausedReason,
    handleBatchFile,
    toggleBatchCompany,
    selectAllBatch,
    selectNoneBatch,
    stopBatch,
    runBatchThroughDecisionMakers,
    resumeFromRun,
  }
}

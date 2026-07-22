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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { RunResult, AnalysisMode } from '@/app/admin/intelligence-lab/_types'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'
import type { DedupedCompany } from '@/lib/batch/company-dedup'
import type { DecisionMakerCandidate } from '@/lib/outbound/decision-maker-discovery/types'
import { quotaSignatureIn, nextConsecutiveHits, shouldPauseBatch, QUOTA_PAUSE_THRESHOLD } from '@/lib/batch/quota-pause'

export type FlowStep = 1 | 2 | 3 | 4 | 5
export type InputMode = 'single' | 'batch'
export type BatchCompanyStatus = 'pending' | 'researching' | 'discovering' | 'done' | 'failed'
type ContactActionKind = 'find-email' | 'delete'
interface SendOutcomeDetail {
  status: 'sent' | 'skipped' | 'failed'
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

function deriveCompanyName(domain: string, analysisResult: Record<string, unknown> | undefined): string {
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
  const [mode, setMode] = useState<AnalysisMode>('lightweight')
  const [researching, setResearching] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [contacts, setContacts] = useState<OutboundContact[]>([])
  const [pendingAction, setPendingAction] = useState<Record<string, ContactActionKind | undefined>>({})
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [sendingContactId, setSendingContactId] = useState<string | null>(null)
  const [sendingAll, setSendingAll] = useState(false)
  const [campaignContactStatus, setCampaignContactStatus] = useState<Record<string, SendOutcomeDetail>>({})

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
    setMode('lightweight')
    setResearching(false)
    setResult(null)
    setError(null)
    setRunId(null)
    setContacts([])
    setPendingAction({})
    setCampaignId(null)
    setSendingContactId(null)
    setSendingAll(false)
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

  const resumeFromRun = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/test-runs?limit=50`)
      const data = await res.json()
      if (!data.success) return
      const run = (data.runs as Array<{ id: string; domain: string; company_url: string; final_result?: Record<string, unknown> }>).find(
        r => r.id === id
      )
      if (!run) return
      setRunId(run.id)
      setUrl(run.company_url)
      setResult({ success: true, domain: run.domain, analysisResult: run.final_result })
      const contactsRes = await fetch(`/api/admin/outbound/contacts?source_run_id=${run.id}`)
      const contactsData = await contactsRes.json()
      if (contactsData.success) setContacts(contactsData.contacts)

      // Restore campaign/send state too (2026-07-19 fix) — without this, a
      // mid-flow refresh at the Review & Send step loses campaignId, and
      // ensureCampaignId() would then create a BRAND NEW campaign on the
      // next Send click. Since send status is scoped per-campaign, that new
      // campaign's contacts all start 'queued' again — re-sending to
      // contacts that were already sent under the original campaign. Single-
      // company mode only (batch mode's campaigns use source_run_id: null,
      // no single run to key off — out of scope for this fix).
      const campaignsRes = await fetch(`/api/admin/outbound/campaigns?source_run_id=${run.id}`)
      const campaignsData = await campaignsRes.json()
      const existingCampaign = campaignsData.success ? campaignsData.campaigns?.[0] : null
      if (existingCampaign) {
        setCampaignId(existingCampaign.id)
        const campaignContactsRes = await fetch(`/api/admin/outbound/campaigns/${existingCampaign.id}/contacts`)
        const campaignContactsData = await campaignContactsRes.json()
        if (campaignContactsData.success) {
          const restored: Record<string, SendOutcomeDetail> = {}
          for (const row of campaignContactsData.contacts as Array<{ contact_id: string; status: string }>) {
            // 'queued' means never sent (or skipped/failed and still
            // retry-eligible) — leave it absent so the contact still shows
            // as sendable. Anything past 'queued' means it went out.
            if (row.status !== 'queued') restored[row.contact_id] = { status: 'sent' }
          }
          setCampaignContactStatus(restored)
        }
      }
    } catch {
      // Resume is best-effort — a failed resume just leaves the flow at step 1.
    }
  }, [])

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
    if (resumeStep >= 1 && resumeStep <= 5) {
      // One-time client-only URL-sync on mount, not a derived-state anti-pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStepState(resumeStep as FlowStep)
      setMaxStepReached(resumeStep as FlowStep)
    }
    setStepSynced(true)
    if (resumeRunId) void resumeFromRun(resumeRunId)
  }, [resumeFromRun])

  const companyName = result?.domain ? deriveCompanyName(result.domain, result.analysisResult) : ''
  const domain = result?.domain ?? ''

  const runResearch = useCallback(async () => {
    const urlNormalized = url.trim()
    if (!urlNormalized) return
    setResearching(true)
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
        body: JSON.stringify({ url: urlNormalized, mode }),
      })
      const data: RunResult = await res.json()
      setResult(data)
      if (!data.success) {
        setError(data.error ?? 'Analysis failed')
        return
      }

      const saveRes = await fetch('/api/admin/test-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      })
      const saveData = await saveRes.json()
      if (saveData.success) {
        // Stay on step 1 — the user reviews the research result and clicks
        // Continue explicitly (see the Continue button rendered below the
        // ResearchCard, and the top-of-page continue control). Auto-
        // advancing here used to skip that review entirely.
        setRunId(saveData.id)
        const params = new URLSearchParams()
        params.set('step', '1')
        params.set('runId', saveData.id)
        router.replace(`/admin/auto-gtm?${params.toString()}`)
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
  }, [url, mode, router])

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
        (data.companies as DedupedCompany[]).map(company => ({
          company,
          selected: true,
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
          ? { url: item.company.companyWebsite, mode: 'lightweight' }
          : { companyName: item.company.companyName, mode: 'lightweight' }

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

  // Lazily creates the underlying campaign the first time anything is sent
  // — "campaign" is deliberately never surfaced as a concept in the guided
  // flow's UI/copy, it's just the existing sending infrastructure this hook
  // drives under the hood, same as before.
  const ensureCampaignId = useCallback(async (): Promise<string | null> => {
    if (campaignId) return campaignId
    try {
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
    }
  }, [campaignId, inputMode, batchCompanies, companyName, runId])

  // Enqueues the given contact ids and sends whatever is queued — the send
  // route only ever touches rows still 'queued', so calling this repeatedly
  // (e.g. Send Email on one contact, then Send All later) is safe and never
  // double-sends. Shared by sendOneContact/sendAllContacts, which differ
  // only in which contact ids they pass. Returns the outcome for each
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

        const sendRes = await fetch(`/api/admin/outbound/campaigns/${cId}/send`, { method: 'POST' })
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
        if (outcome.status === 'sent') toast.success('Sent (mock), no real email leaves the app yet')
        else toast.warning(outcome.reason ?? `Could not send: ${outcome.status}`)
      } finally {
        setSendingContactId(null)
      }
    },
    [enqueueAndSend]
  )

  const sendAllContacts = useCallback(async () => {
    if (contacts.length === 0) {
      toast.error('No contacts to send yet')
      return
    }
    setSendingAll(true)
    try {
      const outcomes = await enqueueAndSend(contacts.map(c => c.id))
      // An empty result here means enqueueAndSend already failed and shown
      // its own toast.error — showing "0 sent, 0 skipped, 0 failed" as a
      // success toast on top of that would be misleading (2026-07-19 fix).
      if (outcomes.length === 0) return
      const sent = outcomes.filter(o => o.status === 'sent').length
      const skipped = outcomes.filter(o => o.status === 'skipped').length
      const failed = outcomes.filter(o => o.status === 'failed').length
      toast.success(`Sent (mock): ${sent} sent, ${skipped} skipped, ${failed} failed`)
    } finally {
      setSendingAll(false)
    }
  }, [contacts, enqueueAndSend])

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
    result,
    error,
    runId,
    companyName,
    domain,
    runResearch,
    contacts,
    addContactRow,
    pendingAction,
    findEmailForContact,
    deleteContact,
    campaignId,
    campaignContactStatus,
    sendingContactId,
    sendingAll,
    sendOneContact,
    sendAllContacts,
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
  }
}

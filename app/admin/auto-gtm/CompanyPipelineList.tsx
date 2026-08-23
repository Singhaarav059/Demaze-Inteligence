'use client'

// ============================================================
// CompanyPipelineList — "Continue Where You Left Off"
// ============================================================
// Rendered on Auto Flow's Research step, below the single-company input,
// only while nothing is actively being researched (see page.tsx's gating
// condition). Backed by GET /api/admin/outbound/pipeline, which groups by
// contact-derived company identity so both single-company AND
// batch-researched companies show up here (see that route's own header for
// why it can't group by outbound_campaigns.source_run_id alone).
//
// Two stages, both from the same endpoint:
// - 'sent': has reached a campaign (real send/open/reply counts) — resume
//   lands on step 6 (Track & Follow Up).
// - 'in_progress': has committed decision-maker contacts but hasn't reached
//   a campaign yet — resume lands on step 4 (Campaign & Outreach), where
//   auto-pilot picks up drafting/review from wherever this run left off.
//
// Styled as researchable company-intelligence cards, not a plain database
// list — flat bordered rows (intelligence-workspace pass) with a real
// IntelStatus dot per company instead of an ad hoc colored Badge.
// ============================================================

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Building2, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { IntelStatus, type IntelStatusKind } from '@/components/ui/intel-status'
import { staggerList, listItem } from '@/lib/motion'

interface SentCompany {
  stage: 'sent'
  runId: string
  companyName: string
  domain: string | null
  companyUrl: string | null
  contactsTotal: number
  sentCount: number
  openedCount: number
  repliedCount: number
  bouncedCount: number
  nextFollowupDueAt: string | null
  lastActivityAt: string
}

interface InProgressCompany {
  stage: 'in_progress'
  runId: string
  companyName: string
  domain: string | null
  companyUrl: string | null
  contactsTotal: number
  draftsReadyCount: number
  lastActivityAt: string
}

type PipelineCompany = SentCompany | InProgressCompany

function relativeTime(iso: string, nowMs: number): string {
  const ms = nowMs - new Date(iso).getTime()
  const hours = Math.floor(ms / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// nowMs is passed in (captured once when the list loads, see
// CompanyPipelineList's own useState below) rather than read via Date.now()
// here — this component renders inside a map, and calling an impure
// function directly in a component body is flagged by this repo's
// react-hooks/purity lint rule; a stable snapshot is also the right
// semantics here anyway (a status list, not a live ticking clock).
// Maps each real pipeline outcome onto IntelStatus's shared status
// vocabulary (dot color) with an honest, specific label override — the
// underlying data is unchanged, only the rendering primitive is shared now.
function pipelineStatus(company: PipelineCompany, nowMs: number): { status: IntelStatusKind; label: string } {
  if (company.stage === 'in_progress') {
    return company.draftsReadyCount > 0
      ? { status: 'needs_review', label: 'Outreach ready' }
      : { status: 'researching', label: 'Decision maker found' }
  }
  if (company.repliedCount > 0) return { status: 'complete', label: 'Replied' }
  if (company.nextFollowupDueAt && new Date(company.nextFollowupDueAt).getTime() <= nowMs) {
    return { status: 'needs_review', label: 'Follow-up due' }
  }
  if (company.bouncedCount > 0 && company.bouncedCount === company.contactsTotal) {
    return { status: 'failed', label: 'Bounced' }
  }
  return { status: 'already_researched', label: 'Sent' }
}

function PipelineStatusBadge({ company, nowMs }: { company: PipelineCompany; nowMs: number }) {
  const { status, label } = pipelineStatus(company, nowMs)
  return <IntelStatus status={status} label={label} />
}

function statusLine(company: PipelineCompany, nowMs: number): string {
  const location = company.domain ?? company.companyUrl
  if (company.stage === 'in_progress') {
    const contactsLabel = `${company.contactsTotal} decision maker${company.contactsTotal === 1 ? '' : 's'} found`
    const draftsLabel = company.draftsReadyCount > 0 ? `${company.draftsReadyCount} draft${company.draftsReadyCount === 1 ? '' : 's'} ready` : null
    return [location, contactsLabel, draftsLabel, relativeTime(company.lastActivityAt, nowMs)].filter(Boolean).join(' · ')
  }
  return `${location} · ${company.sentCount}/${company.contactsTotal} sent · ${company.openedCount} opened · ${relativeTime(company.lastActivityAt, nowMs)}`
}

export function CompanyPipelineList({
  onResume,
}: {
  // Told which step to land on, since the two stages resume to different
  // places — see this file's header comment.
  onResume: (runId: string, step: 4 | 6) => Promise<void>
}) {
  const [companies, setCompanies] = useState<PipelineCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [resumingRunId, setResumingRunId] = useState<string | null>(null)
  // Captured once, from the API response's own `now` timestamp — a stable
  // snapshot for this list's lifetime rather than a live-ticking clock (and
  // avoids calling Date.now() during render, see PipelineStatusBadge above).
  const [nowMs, setNowMs] = useState(0)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/outbound/pipeline')
        const data = await res.json()
        if (data.success) {
          setCompanies(data.companies)
          setNowMs(data.now ? new Date(data.now).getTime() : Date.now())
        }
      } catch {
        // Non-fatal — the Research step still works fine with this section
        // just empty; nothing here blocks starting new research.
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function handleResume(runId: string, step: 4 | 6) {
    setResumingRunId(runId)
    try {
      await onResume(runId, step)
    } catch {
      toast.error('Could not resume this company')
    } finally {
      setResumingRunId(null)
    }
  }

  if (loading) return null // avoids a layout flash before the first fetch resolves

  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-3">
      <div className="flex items-center gap-2">
        <History className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">Continue Where You Left Off</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Companies already researched — resume to pick up outreach or check status.
          </p>
        </div>
      </div>

      {companies.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic">
          Nothing in progress yet — research a company below to get started.
        </p>
      ) : (
        <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-1.5">
          {companies.map(company => (
            <motion.div
              key={company.runId}
              variants={listItem}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-border/70 bg-background/40 transition-colors hover:border-border-strong"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground">
                <Building2 className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{company.companyName}</span>
                  <PipelineStatusBadge company={company} nowMs={nowMs} />
                </div>
                <p className="text-xs text-muted-foreground/70 truncate">
                  {statusLine(company, nowMs)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={resumingRunId === company.runId}
                onClick={() => handleResume(company.runId, company.stage === 'in_progress' ? 4 : 6)}
              >
                {resumingRunId === company.runId ? <Spinner className="size-3.5" /> : null}
                Resume
              </Button>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  )
}

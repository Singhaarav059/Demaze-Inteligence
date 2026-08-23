'use client'

// ============================================================
// Pilot Review - /admin/outbound/pilot-review
// ============================================================
// Post-Hardening Pilot Readiness Plan, Phase F2 (human quality review).
// "Before sending, manually inspect every pilot contact. Confirm: right
// company, right problem, right evidence, right stakeholder." This is
// exactly that checkpoint - read-only research data plus a persisted
// approve/reject/needs-work decision per company (GET/PATCH
// /api/admin/outbound/pilot-review), gating nothing automatically: outreach
// generation and sending stay behind their own existing checks regardless
// of what's recorded here. Deliberately temporary/pilot-scoped UI, not a
// permanent workflow tool (see migration 025's own header comment).
// ============================================================

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { CheckCircle2, XCircle, AlertTriangle, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { GuideNote } from '@/components/ui/guide-note'
import { EmptyState } from '@/components/ui/empty-state'
import { staggerList, listItem } from '@/lib/motion'

type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'needs_work'

interface PilotContact {
  personName: string | null
  titleHint: string | null
  confidence: string | null
  groundingStatus: string | null
}

interface PilotCompany {
  runId: string
  companyName: string
  domain: string | null
  companyUrl: string | null
  createdAt: string
  industry: string | null
  headquartersLocation: string | null
  icpSegment: string | null
  sourceList: string | null
  whyThisCompany: string | null
  whyNow: string | null
  overallConfidence: string | null
  evidenceSufficiency: string | null
  opportunityCount: number
  topOpportunity: { title: string | null; evidence: string | null; reasoning: string | null; relevance: string | null } | null
  contacts: PilotContact[]
  reviewStatus: ReviewStatus
  reviewNote: string | null
  reviewedAt: string | null
}

const STATUS_META: Record<ReviewStatus, { label: string; className: string }> = {
  pending: { label: 'Pending review', className: 'bg-accent text-muted-foreground' },
  approved: { label: 'Approved', className: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30' },
  rejected: { label: 'Rejected', className: 'bg-destructive/10 text-destructive border border-destructive/40' },
  needs_work: { label: 'Needs work', className: 'bg-signal-medium/10 text-signal-medium border border-signal-medium/30' },
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending
  return <Badge className={`text-[10px] ${meta.className}`}>{meta.label}</Badge>
}

function ReviewCard({
  company,
  onReview,
}: {
  company: PilotCompany
  onReview: (runId: string, status: ReviewStatus, note: string) => Promise<void>
}) {
  const [note, setNote] = useState(company.reviewNote ?? '')
  const [saving, setSaving] = useState<ReviewStatus | null>(null)

  async function handleReview(status: ReviewStatus) {
    setSaving(status)
    try {
      await onReview(company.runId, status, note)
    } finally {
      setSaving(null)
    }
  }

  return (
    <motion.div variants={listItem} className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">{company.companyName}</h3>
            <StatusBadge status={company.reviewStatus} />
            {company.evidenceSufficiency === 'insufficient' && (
              <Badge className="text-[10px] bg-signal-medium/10 text-signal-medium border border-signal-medium/30">
                Insufficient evidence
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            {[company.industry, company.headquartersLocation, company.icpSegment, company.sourceList].filter(Boolean).join(' · ')}
          </p>
        </div>
        {company.domain && (
          <a
            href={`https://${company.domain}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            {company.domain} <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {company.whyThisCompany && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Why this company / what to sell</p>
          <p className="text-sm text-foreground/90 mt-0.5">{company.whyThisCompany}</p>
        </div>
      )}
      {company.whyNow && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Why now</p>
          <p className="text-sm text-foreground/90 mt-0.5">{company.whyNow}</p>
        </div>
      )}
      {company.topOpportunity && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Strongest opportunity ({company.opportunityCount} total{company.topOpportunity.relevance ? `, ${company.topOpportunity.relevance} relevance` : ''})
          </p>
          <p className="text-sm text-foreground/90 mt-0.5">{company.topOpportunity.title}</p>
          {company.topOpportunity.evidence && (
            <p className="text-xs text-muted-foreground/80 mt-0.5 italic">&ldquo;{company.topOpportunity.evidence}&rdquo;</p>
          )}
          {!company.topOpportunity.evidence && company.topOpportunity.reasoning && (
            <p className="text-xs text-muted-foreground/80 mt-0.5">{company.topOpportunity.reasoning}</p>
          )}
        </div>
      )}
      {!company.topOpportunity && (
        <p className="text-xs text-muted-foreground/60 italic">No opportunity surfaced - genuinely thin evidence, not a display gap.</p>
      )}

      <div>
        <p className="text-xs font-medium text-muted-foreground">Candidate stakeholders ({company.contacts.length})</p>
        {company.contacts.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic mt-0.5">None found.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {company.contacts.map((c, i) => (
              <li key={i} className="text-xs text-foreground/80 flex items-center gap-1.5 flex-wrap">
                <span className="font-medium">{c.personName ?? 'Unnamed'}</span>
                {c.titleHint && <span className="text-muted-foreground">- {c.titleHint}</span>}
                {c.confidence && <span className="text-muted-foreground/60">({c.confidence})</span>}
                {c.groundingStatus === 'conflict' && (
                  <Badge className="text-[9px] bg-destructive/10 text-destructive border border-destructive/40">identity conflict</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 pt-1 border-t border-border">
        <Textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Optional review note (e.g. what's wrong, or why this looks good)"
          className="min-h-14 text-sm"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="text-signal-strong border-signal-strong/40 hover:bg-signal-strong/10" disabled={saving !== null} onClick={() => handleReview('approved')}>
            {saving === 'approved' ? <Spinner className="size-3.5" /> : <CheckCircle2 className="size-3.5" />} Approve
          </Button>
          <Button size="sm" variant="outline" className="text-signal-medium border-signal-medium/40 hover:bg-signal-medium/10" disabled={saving !== null} onClick={() => handleReview('needs_work')}>
            {saving === 'needs_work' ? <Spinner className="size-3.5" /> : <AlertTriangle className="size-3.5" />} Needs work
          </Button>
          <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" disabled={saving !== null} onClick={() => handleReview('rejected')}>
            {saving === 'rejected' ? <Spinner className="size-3.5" /> : <XCircle className="size-3.5" />} Reject
          </Button>
          {company.reviewedAt && (
            <span className="text-[10px] text-muted-foreground/60 ml-auto">
              Last reviewed {new Date(company.reviewedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export default function PilotReviewPage() {
  const [companies, setCompanies] = useState<PilotCompany[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/outbound/pilot-review')
      const data = await res.json()
      if (data.success) setCompanies(data.companies)
      else toast.error(data.error ?? 'Could not load pilot review data')
    } catch {
      toast.error('Could not load pilot review data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function handleReview(runId: string, status: ReviewStatus, note: string) {
    try {
      const res = await fetch(`/api/admin/outbound/pilot-review/${runId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note: note.trim() || undefined }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Could not save review')
        return
      }
      setCompanies(prev =>
        prev.map(c => (c.runId === runId ? { ...c, reviewStatus: status, reviewNote: note.trim() || null, reviewedAt: new Date().toISOString() } : c))
      )
    } catch {
      toast.error('Could not save review')
    }
  }

  const counts = companies.reduce(
    (acc, c) => ({ ...acc, [c.reviewStatus]: (acc[c.reviewStatus] ?? 0) + 1 }),
    {} as Record<ReviewStatus, number>
  )

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Pilot Review</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manually inspect every researched pilot company before outreach gets generated.
        </p>
      </div>

      <GuideNote>
        <p>
          Confirm for each: right company, right problem, right evidence, right stakeholder. This
          is a temporary validation step for the pilot, not the final operating model - nothing
          here auto-sends or auto-generates outreach; it only records your decision.
        </p>
      </GuideNote>

      {!loading && companies.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Badge className={`${STATUS_META.pending.className}`}>{counts.pending ?? 0} pending</Badge>
          <Badge className={`${STATUS_META.approved.className}`}>{counts.approved ?? 0} approved</Badge>
          <Badge className={`${STATUS_META.needs_work.className}`}>{counts.needs_work ?? 0} needs work</Badge>
          <Badge className={`${STATUS_META.rejected.className}`}>{counts.rejected ?? 0} rejected</Badge>
          <span className="text-muted-foreground/60 ml-1">{companies.length} total</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Spinner className="size-4" /> Loading pilot batch…
        </div>
      ) : companies.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No pilot batch to review yet"
          description="This fills in once a batch of pilot companies has been researched - nothing has been tagged as a pilot run yet."
        />
      ) : (
        <div className="rounded-lg border border-border bg-card p-4">
          <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-3">
            {companies.map(c => (
              <ReviewCard key={c.runId} company={c} onReview={handleReview} />
            ))}
          </motion.div>
        </div>
      )}
    </div>
  )
}

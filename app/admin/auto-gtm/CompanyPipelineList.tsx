'use client'

// ============================================================
// CompanyPipelineList — persistent "already sent" companies list
// ============================================================
// Rendered on Auto Flow's Research step, below the single-company input,
// only while nothing is actively being researched (see page.tsx's gating
// condition). Backed by GET /api/admin/outbound/pipeline, which groups by
// contact-derived company identity so both single-company AND
// batch-researched companies show up here (see that route's own header for
// why it can't group by outbound_campaigns.source_run_id alone).
//
// Styled to match this app's Auto-Flow-consistent visual pattern
// (GlassCard header, framer-motion stagger, semantic-colored status
// badges) already applied to the Warm-Up/Follow-ups/Campaigns pages.
//
// Resume always lands on step 4 (Outreach & Send) — every row here has, by
// construction, already reached that step at least once (a campaign only
// ever gets created from there), so this is never a guess.
// ============================================================

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { GlassCard } from '@/components/ui/glass-card'
import { CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { staggerList, listItem } from '@/lib/motion'

interface PipelineCompany {
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
function PipelineStatusBadge({ company, nowMs }: { company: PipelineCompany; nowMs: number }) {
  if (company.repliedCount > 0) {
    return <Badge className="text-[10px] bg-signal-strong/10 text-signal-strong border border-signal-strong/30">Replied</Badge>
  }
  if (company.nextFollowupDueAt && new Date(company.nextFollowupDueAt).getTime() <= nowMs) {
    return <Badge className="text-[10px] bg-primary/10 text-primary border border-primary/40">Follow-up due</Badge>
  }
  if (company.bouncedCount > 0 && company.bouncedCount === company.contactsTotal) {
    return <Badge className="text-[10px] bg-destructive/10 text-destructive border border-destructive/40">Bounced</Badge>
  }
  return <Badge className="text-[10px] bg-accent text-muted-foreground">Sent</Badge>
}

export function CompanyPipelineList({
  onResume,
}: {
  onResume: (runId: string) => Promise<void>
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

  async function handleResume(runId: string) {
    setResumingRunId(runId)
    try {
      await onResume(runId)
    } catch {
      toast.error('Could not resume this company')
    } finally {
      setResumingRunId(null)
    }
  }

  if (loading) return null // avoids a layout flash before the first fetch resolves

  return (
    <GlassCard>
      <CardContent className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Sent Companies</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Companies already researched and sent to — resume to check status or continue outreach.
          </p>
        </div>

        {companies.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic">
            No companies sent yet — research one below to get started.
          </p>
        ) : (
          <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-1.5">
            {companies.map(company => (
              <motion.div
                key={company.runId}
                variants={listItem}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{company.companyName}</span>
                    <PipelineStatusBadge company={company} nowMs={nowMs} />
                  </div>
                  <p className="text-xs text-muted-foreground/70 truncate">
                    {company.domain ?? company.companyUrl} · {company.sentCount}/{company.contactsTotal} sent ·{' '}
                    {company.openedCount} opened · {relativeTime(company.lastActivityAt, nowMs)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={resumingRunId === company.runId}
                  onClick={() => handleResume(company.runId)}
                >
                  {resumingRunId === company.runId ? <Spinner className="size-3.5" /> : null}
                  Resume
                </Button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </CardContent>
    </GlassCard>
  )
}

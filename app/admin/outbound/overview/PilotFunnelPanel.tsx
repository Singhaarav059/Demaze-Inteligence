'use client'

// ============================================================
// Pilot Funnel Panel — /admin/outbound/overview
// ============================================================
// Post-Hardening Pilot Readiness Plan, Phase D5: "if the existing UI can
// display these metrics without major redesign, add a focused pilot view.
// Do not build a new analytics platform." Folded into the existing
// Overview page (no new nav entry, no new page) rather than a standalone
// dashboard — reads GET /api/admin/outbound/pilot-funnel, which does all
// the aggregation; this component only renders it.
// ============================================================

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Funnel, TriangleAlert } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusDot, type StatusTone } from '../StatusDot'

interface PilotFunnel {
  companiesEntered: number
  researchCompleted: number
  researchWarnings: number
  validOpportunities: number
  icpMatched: number
  decisionMakerFound: number
  emailFound: number
  emailQAPassed: number
  approved: number
  sent: number
  replied: number
}

interface PilotFailures {
  relevanceOrEvidenceFailure: number
  identityFailure: number
  icpFailure: number
  peopleDataFailure: number
  emailFailure: number
  qaFailure: number
  sendFailure: number
  suppression: number
}

interface PilotCompanyTrace {
  runId: string
  companyName: string
  domain: string | null
  qaStatus: 'passed' | 'failed' | 'not_attempted'
  sendStatus: 'sent' | 'queued_not_sent' | 'not_approved'
  outcome: 'replied' | 'bounced' | 'opened' | 'no_reply_yet' | 'n/a'
}

const FUNNEL_STAGES: Array<{ key: keyof PilotFunnel; label: string }> = [
  { key: 'companiesEntered', label: 'Companies entered' },
  { key: 'researchCompleted', label: 'Research completed' },
  { key: 'validOpportunities', label: 'Valid opportunities' },
  { key: 'icpMatched', label: 'ICP matched' },
  { key: 'decisionMakerFound', label: 'Decision maker found' },
  { key: 'emailFound', label: 'Email found' },
  { key: 'emailQAPassed', label: 'Email QA passed' },
  { key: 'approved', label: 'Approved (enqueued)' },
  { key: 'sent', label: 'Sent' },
  { key: 'replied', label: 'Replied' },
]

const FAILURE_LABELS: Record<keyof PilotFailures, string> = {
  relevanceOrEvidenceFailure: 'Relevance / evidence',
  identityFailure: 'Identity conflict',
  icpFailure: 'ICP',
  peopleDataFailure: 'People-data',
  emailFailure: 'Email',
  qaFailure: 'QA',
  sendFailure: 'Send',
  suppression: 'Suppression',
}

function outcomeTone(outcome: PilotCompanyTrace['outcome']): StatusTone {
  if (outcome === 'replied') return 'strong'
  if (outcome === 'bounced') return 'destructive'
  if (outcome === 'opened') return 'medium'
  return 'muted'
}

function qaTone(status: PilotCompanyTrace['qaStatus']): StatusTone {
  if (status === 'passed') return 'strong'
  if (status === 'failed') return 'destructive'
  return 'muted'
}

export function PilotFunnelPanel() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [funnel, setFunnel] = useState<PilotFunnel | null>(null)
  const [failures, setFailures] = useState<PilotFailures | null>(null)
  const [companies, setCompanies] = useState<PilotCompanyTrace[]>([])

  useEffect(() => {
    if (!open || loaded) return
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch('/api/admin/outbound/pilot-funnel')
        const data = await res.json()
        if (data.success) {
          setFunnel(data.funnel)
          setFailures(data.failures)
          setCompanies(data.companies)
          setLoaded(true)
        }
      } catch {
        // non-fatal — panel just stays empty, no toast for a collapsed-by-default section
      } finally {
        setLoading(false)
      }
    })()
  }, [open, loaded])

  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex w-full items-center gap-2 text-left"
        >
          {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
          <Funnel className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Pilot Funnel</span>
          <span className="text-xs text-muted-foreground">— company research → send → outcome, across every researched company</span>
        </button>

        {open && (
          <div className="space-y-4 pt-1">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Spinner className="size-4" /> Loading pilot funnel…
              </div>
            )}

            {!loading && funnel && funnel.companiesEntered === 0 && (
              <EmptyState
                icon={Funnel}
                title="No researched companies yet"
                description="The funnel fills in once companies have been researched through Auto Flow or batch upload."
              />
            )}

            {!loading && funnel && funnel.companiesEntered > 0 && (
              <>
                {/* Stepped funnel — small flat tiles chained by a chevron, not a wall
                    of charts. Real stage counts only, from the funnel API. */}
                <div className="flex flex-wrap items-stretch gap-1.5">
                  {FUNNEL_STAGES.map(({ key, label }, i) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <div className="rounded-md border border-border bg-background px-3 py-2 text-center min-w-20">
                        <div className="text-lg font-semibold tabular-nums text-foreground">{funnel[key]}</div>
                        <div className="text-[10px] text-muted-foreground/70 leading-tight">{label}</div>
                      </div>
                      {i < FUNNEL_STAGES.length - 1 && (
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/30" />
                      )}
                    </div>
                  ))}
                </div>

                {failures && Object.values(failures).some(v => v > 0) && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <TriangleAlert className="size-3.5" /> Failure breakdown
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {(Object.keys(FAILURE_LABELS) as Array<keyof PilotFailures>)
                        .filter(k => failures[k] > 0)
                        .map(k => (
                          <span key={k} className="text-xs text-muted-foreground">
                            {FAILURE_LABELS[k]}: <span className="text-foreground font-medium">{failures[k]}</span>
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground/70">
                        <th className="pb-1.5 pr-3 font-medium">Company</th>
                        <th className="pb-1.5 pr-3 font-medium">QA</th>
                        <th className="pb-1.5 pr-3 font-medium">Send</th>
                        <th className="pb-1.5 font-medium">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companies.map(c => (
                        <tr key={c.runId} className="border-t border-border">
                          <td className="py-1.5 pr-3 text-foreground">{c.companyName}</td>
                          <td className="py-1.5 pr-3">
                            <StatusDot tone={qaTone(c.qaStatus)} label={c.qaStatus.replace('_', ' ')} />
                          </td>
                          <td className="py-1.5 pr-3 text-muted-foreground">{c.sendStatus.replace(/_/g, ' ')}</td>
                          <td className="py-1.5">
                            <StatusDot tone={outcomeTone(c.outcome)} label={c.outcome.replace(/_/g, ' ')} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
    </div>
  )
}

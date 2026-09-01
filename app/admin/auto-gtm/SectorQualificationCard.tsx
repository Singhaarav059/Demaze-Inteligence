'use client'

// ============================================================
// SectorQualificationCard - Auto Flow's "is this company in scope, and
// why" display
// ============================================================
// Renders lib/sector-playbook's qualification scorecard (DRAFT). Lives in
// Auto Flow, not the Research product (app/admin/intelligence-lab) - the
// dedicated Research section stays sector-agnostic deep research; sector
// qualification against Demaze's 3 active target sectors is an Auto Flow
// concept only. Shown inline on the Research step (full detail) and
// compactly on Review & Send (Part 20's "Sector"/"Confidence" requirement)
// - never as its own step, per the standing "no Sales Strategy step" rule.
// ============================================================

import { useState } from 'react'
import { CheckCircle2, ChevronRight, Lightbulb, Target } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { InfoTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { fitLabel } from '@/lib/ui/fit-label'
import type { QualificationResult } from '@/lib/sector-playbook/qualify'

function scoreColor(score: number): string {
  if (score >= 75) return 'text-signal-strong'
  if (score >= 50) return 'text-signal-medium'
  if (score >= 25) return 'text-muted-foreground'
  return 'text-destructive'
}

function scoreBarColor(score: number): string {
  if (score >= 75) return 'bg-signal-strong'
  if (score >= 50) return 'bg-signal-medium'
  if (score >= 25) return 'bg-muted-foreground'
  return 'bg-destructive'
}

function ScoreRow({ label, score, reasons }: { label: string; score: number | null; reasons: string[] }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-foreground">{label}</p>
          <span className={cn('shrink-0 text-sm font-semibold tabular-nums', score === null ? 'text-muted-foreground/50' : scoreColor(score))}>
            {score === null ? '-' : score}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/70 mt-0.5">{reasons[0]}</p>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-accent">
          <div
            className={cn('h-full rounded-full transition-all', score === null ? 'bg-muted-foreground/30' : scoreBarColor(score))}
            style={{ width: `${score ?? 0}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export function SectorQualificationCard({ qualification, companyFitLabel = 'Company fit' }: { qualification: QualificationResult; companyFitLabel?: string }) {
  const { classification, playbook, sectorFit, companyFit, opportunityEvidence, contactability, overall, matchedOpportunities } = qualification
  const [detailsOpen, setDetailsOpen] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
          <h3 className="text-base font-semibold text-foreground">{fitLabel(overall.score)}</h3>
          <InfoTooltip>
            Based on a draft sector playbook, not the official approved Demaze sector strategy yet. Directional, not precise.
          </InfoTooltip>
        </div>
        <span className={cn('text-sm font-medium tabular-nums text-muted-foreground', scoreColor(overall.score))}>{overall.score}/100</span>
      </div>

      {playbook ? (
        <Badge className="text-[11px] bg-primary/10 text-primary border border-primary/30">{playbook.label}</Badge>
      ) : (
        <Badge variant="secondary" className="text-[11px]">Outside current target sectors</Badge>
      )}
      <p className="text-xs text-muted-foreground">{classification.reason}</p>

      <button
        type="button"
        onClick={() => setDetailsOpen(v => !v)}
        aria-expanded={detailsOpen}
        className="flex items-center gap-1.5 pt-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', detailsOpen && 'rotate-90')} />
        See scoring details
      </button>
      {detailsOpen && (
        <div className="border-t border-border pt-2">
          <ScoreRow label="Sector fit" score={sectorFit.score} reasons={sectorFit.reasons} />
          <ScoreRow label={companyFitLabel} score={companyFit.score} reasons={companyFit.reasons} />
          <ScoreRow label="Opportunity evidence" score={opportunityEvidence.score} reasons={opportunityEvidence.reasons} />
          <ScoreRow label="Contactability" score={contactability.score} reasons={contactability.reasons} />
        </div>
      )}

      {matchedOpportunities.length > 0 && (
        <div className="pt-1 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Potential opportunities</p>
          {matchedOpportunities.map((m, i) => (
            <div
              key={i}
              className={cn(
                'rounded border-l-2 bg-accent/30 px-2.5 py-1.5',
                m.tier === 'confirmed' ? 'border-l-signal-strong/50' : 'border-l-signal-medium/50'
              )}
            >
              <div className="flex items-center gap-1.5">
                <Badge
                  className={cn(
                    'text-[9px] gap-1',
                    m.tier === 'confirmed'
                      ? 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30'
                      : 'bg-signal-medium/10 text-signal-medium border border-signal-medium/30'
                  )}
                >
                  {m.tier === 'confirmed' ? <CheckCircle2 className="size-2.5" /> : <Lightbulb className="size-2.5" />}
                  {m.tier === 'confirmed' ? 'Confirmed evidence' : 'Reasonable inference'}
                </Badge>
                <span className="text-[11px] text-muted-foreground/70">{m.capability}</span>
              </div>
              <p className="text-xs text-foreground/90 mt-0.5">{m.possibleProblem}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CompactSectorBadge({ qualification }: { qualification: QualificationResult }) {
  const { playbook, overall } = qualification
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Badge variant={playbook ? 'default' : 'secondary'} className="text-[10px]">
        {playbook ? playbook.label : 'Outside target sectors'}
      </Badge>
      <span className="text-muted-foreground/60">·</span>
      <span className={cn('font-medium', scoreColor(overall.score))}>{fitLabel(overall.score)}</span>
    </div>
  )
}

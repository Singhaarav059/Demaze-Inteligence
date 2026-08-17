'use client'

// ============================================================
// SectorQualificationCard — Auto Flow's "is this company in scope, and
// why" display
// ============================================================
// Renders lib/sector-playbook's qualification scorecard (DRAFT). Lives in
// Auto Flow, not the Research product (app/admin/intelligence-lab) — the
// dedicated Research section stays sector-agnostic deep research; sector
// qualification against Demaze's 3 active target sectors is an Auto Flow
// concept only. Shown inline on the Research step (full detail) and
// compactly on Review & Send (Part 20's "Sector"/"Confidence" requirement)
// — never as its own step, per the standing "no Sales Strategy step" rule.
// ============================================================

import { Badge } from '@/components/ui/badge'
import { InfoTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { QualificationResult } from '@/lib/sector-playbook/qualify'

function scoreColor(score: number): string {
  if (score >= 75) return 'text-signal-strong'
  if (score >= 50) return 'text-signal-medium'
  if (score >= 25) return 'text-muted-foreground'
  return 'text-destructive'
}

function ScoreRow({ label, score, reasons }: { label: string; score: number | null; reasons: string[] }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground/70">{reasons[0]}</p>
      </div>
      <span className={cn('shrink-0 text-sm font-semibold tabular-nums', score === null ? 'text-muted-foreground/50' : scoreColor(score))}>
        {score === null ? '—' : score}
      </span>
    </div>
  )
}

export function SectorQualificationCard({ qualification }: { qualification: QualificationResult }) {
  const { classification, playbook, sectorFit, companyFit, opportunityEvidence, contactability, overall, matchedOpportunities } = qualification

  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Target Sector & Fit</h3>
          <Badge variant="secondary" className="text-[10px]">DRAFT</Badge>
          <InfoTooltip>
            Based on a draft sector playbook, not the official approved Demaze sector strategy yet. Scores are directional, not precise.
          </InfoTooltip>
        </div>
        <span className={cn('text-lg font-semibold tabular-nums', scoreColor(overall.score))}>{overall.score}/100</span>
      </div>

      {playbook ? (
        <Badge className="text-[11px] bg-primary/10 text-primary border border-primary/30">{playbook.label}</Badge>
      ) : (
        <Badge variant="secondary" className="text-[11px]">Outside current target sectors</Badge>
      )}
      <p className="text-xs text-muted-foreground">{classification.reason}</p>

      <div className="pt-1">
        <ScoreRow label="Sector fit" score={sectorFit.score} reasons={sectorFit.reasons} />
        <ScoreRow label="Company fit" score={companyFit.score} reasons={companyFit.reasons} />
        <ScoreRow label="Opportunity evidence" score={opportunityEvidence.score} reasons={opportunityEvidence.reasons} />
        <ScoreRow label="Contactability" score={contactability.score} reasons={contactability.reasons} />
      </div>

      {matchedOpportunities.length > 0 && (
        <div className="pt-1 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Possible opportunities</p>
          {matchedOpportunities.map((m, i) => (
            <div key={i} className="rounded border border-border/60 bg-accent/30 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <Badge variant={m.tier === 'confirmed' ? 'default' : 'secondary'} className="text-[9px]">
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
      <span className="text-muted-foreground/60">Sector</span>
      <Badge variant={playbook ? 'default' : 'secondary'} className="text-[10px]">
        {playbook ? playbook.label : 'Outside target sectors'}
      </Badge>
      <span className="text-muted-foreground/60">·</span>
      <span className={cn('font-medium tabular-nums', scoreColor(overall.score))}>{overall.score}/100 fit</span>
      <Badge variant="secondary" className="text-[9px]">DRAFT</Badge>
    </div>
  )
}

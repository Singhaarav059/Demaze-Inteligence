'use client'

// ============================================================
// AutoFlowResearchSummary — Auto Flow step 1's research display
// ============================================================
// Auto Flow and the dedicated Research section (intelligence-lab) serve
// different purposes: Research answers "tell me everything useful about
// this company," Auto Flow only needs "understand this company well enough
// to identify the right person and prepare outbound." Auto Flow's step 1
// used to render the full <ResearchCard>, including Competitors, Target
// Customer Segments, Market Intelligence, Pain Points/Opportunities,
// Research Quality, and an Outreach Draft — the entire deep-research
// report, which reads as a duplicate of the Research product rather than a
// lightweight outbound-prep step.
//
// This component reuses ResearchCard's own exported building blocks
// (getResearchCardData + its individually-exported sections — built for
// exactly this "regroup into a different flow without duplicating markup"
// purpose, see that file's header) instead of re-deriving anything: same
// underlying analysisResult, same pipeline, same data. Nothing about the
// backend research call or the stored result changes — only what Auto
// Flow's UI chooses to show. The full picture (including everything
// omitted here) is always one click away in the Research section.
//
// Shown: company identity/summary/facts, Business Profile (what it does,
// who it serves, market positioning — literally "what is this company /
// what does it do / what kind of business is it" from the Auto Flow spec),
// Recent News, and the Personalization Summary (why_contact/what_to_sell/
// why_now — purpose-built outbound framing).
// Omitted: Competitors, Target Customer Segments, Market Intelligence,
// Pain Points & Opportunities, Research Quality audit, Outreach Draft, and
// the PDF/Word export toolbar — all either deep-research content that
// belongs to the Research section, or (Outreach Draft) superseded by Auto
// Flow's own Campaign & Outreach step.
// ============================================================

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  getResearchCardData,
  AISynthesisFailureBanner,
  BusinessProfileSection,
  RecentNewsSection,
  PersonalizationSummarySection,
} from '@/app/admin/intelligence-lab/ResearchCard'
import { SectorQualificationCard } from './SectorQualificationCard'
import type { RunResult } from '@/app/admin/intelligence-lab/_types'
import type { QualificationResult } from '@/lib/sector-playbook/qualify'

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <span className="text-right text-xs font-medium text-foreground/90">{value}</span>
    </div>
  )
}

export function AutoFlowResearchSummary({
  result,
  qualification,
}: {
  result: RunResult
  qualification: QualificationResult | null
}) {
  const data = getResearchCardData(result)
  if (!data) return null

  const {
    companyName, industry, subIndustry, summary, businessModel, confidence,
    aiSynthesisFailed, aiSynthesisFailureReason, recentActivity,
    businessProfile, openingAngle, whatToSell, whyNow, whyContact, likelyProblem, facts,
  } = data

  const confText =
    confidence === 'high' ? 'text-signal-strong' : confidence === 'medium' ? 'text-signal-medium' : 'text-muted-foreground'

  return (
    <div className="space-y-3">
      <AISynthesisFailureBanner failed={aiSynthesisFailed} reason={aiSynthesisFailureReason} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="border-border bg-card lg:col-span-2">
          <CardContent className="px-6 py-5">
            <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{companyName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {[industry, subIndustry && subIndustry !== industry ? subIndustry : null].filter(Boolean).join(' · ')}
              {confidence && <span className={cn('ml-2 text-xs', confText)}>({confidence} confidence)</span>}
            </p>
            {summary && (
              <p className="mt-4 border-t border-border pt-4 text-[15px] leading-relaxed text-foreground/90">{summary}</p>
            )}
            {businessModel && !summary.toLowerCase().includes(businessModel.toLowerCase().slice(0, 20)) && (
              <p className="mt-2 text-xs italic text-muted-foreground">{businessModel}</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="px-5 py-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              At a glance
            </p>
            {facts.length > 0 ? (
              <div className="divide-y divide-border/60">
                {facts.map((f) => (
                  <Fact key={f.label} label={f.label} value={f.value} />
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">No firmographic detail extracted.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {qualification && <SectorQualificationCard qualification={qualification} />}

      <BusinessProfileSection profile={businessProfile} />
      <RecentNewsSection items={recentActivity} />
      <PersonalizationSummarySection openingAngle={openingAngle} whatToSell={whatToSell} whyNow={whyNow} whyContact={whyContact} likelyProblem={likelyProblem} />
    </div>
  )
}

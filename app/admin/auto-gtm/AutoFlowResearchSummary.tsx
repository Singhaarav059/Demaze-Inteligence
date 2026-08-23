'use client'

// ============================================================
// AutoFlowResearchSummary - Auto Flow step 1's research display
// ============================================================
// Auto Flow and the dedicated Research section (intelligence-lab) serve
// different purposes: Research answers "tell me everything useful about
// this company," Auto Flow only needs "understand this company well enough
// to identify the right person and prepare outbound." Auto Flow's step 1
// used to render the full <ResearchCard>, including Competitors, Target
// Customer Segments, Market Intelligence, Pain Points/Opportunities,
// Research Quality, and an Outreach Draft - the entire deep-research
// report, which reads as a duplicate of the Research product rather than a
// lightweight outbound-prep step.
//
// This component reuses ResearchCard's own exported building blocks
// (getResearchCardData + its individually-exported sections - built for
// exactly this "regroup into a different flow without duplicating markup"
// purpose, see that file's header) instead of re-deriving anything: same
// underlying analysisResult, same pipeline, same data. Nothing about the
// backend research call or the stored result changes - only what Auto
// Flow's UI chooses to show. The full picture (including everything
// omitted here) is always one click away in the Research section.
//
// Shown: a short company-description paragraph, Business Profile (what it
// does, who it serves, market positioning - literally "what is this
// company / what does it do / what kind of business is it" from the Auto
// Flow spec), sector qualification, Recent News, and an evidence-driven
// "Intelligence Snapshot" (why_contact/what_to_sell/why_now - purpose-built
// outbound framing, rendered via EvidenceStack instead of a plain-text
// list so it reads as evidence -> inference -> the Demaze opportunity it
// implies, not a flat FAQ).
// Omitted: Competitors, Target Customer Segments, Market Intelligence,
// Pain Points & Opportunities, Research Quality audit, Outreach Draft, and
// the PDF/Word export toolbar - all either deep-research content that
// belongs to the Research section, or (Outreach Draft) superseded by Auto
// Flow's own Campaign & Outreach step. Company name/industry/HQ/size and
// the signal/opportunity/contact counts are shown once, in page.tsx's own
// company-header strip above this component - not repeated here.
// ============================================================

import { Lightbulb } from 'lucide-react'
import { EvidenceStack } from '@/components/ui/evidence-stack'
import {
  getResearchCardData,
  AISynthesisFailureBanner,
  BusinessProfileSection,
  RecentNewsSection,
} from '@/app/admin/intelligence-lab/ResearchCard'
import { SectorQualificationCard } from './SectorQualificationCard'
import type { RunResult } from '@/app/admin/intelligence-lab/_types'
import type { QualificationResult } from '@/lib/sector-playbook/qualify'

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
    summary, businessModel,
    aiSynthesisFailed, aiSynthesisFailureReason, recentActivity,
    businessProfile, openingAngle, whatToSell, whyNow, whyContact, likelyProblem,
  } = data

  // Nothing real to show if every personalization field came back empty -
  // an EvidenceStack with no fact would be an empty placeholder, so this
  // whole section is skipped rather than rendered hollow.
  const hasPersonalization = Boolean(whyContact || likelyProblem || whyNow || whatToSell || openingAngle)

  return (
    <div className="space-y-3">
      <AISynthesisFailureBanner failed={aiSynthesisFailed} reason={aiSynthesisFailureReason} />

      {summary && (
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Company Description</p>
          <p className="mt-2 text-sm leading-relaxed text-foreground/90">{summary}</p>
          {businessModel && !summary.toLowerCase().includes(businessModel.toLowerCase().slice(0, 20)) && (
            <p className="mt-2 text-xs italic text-muted-foreground">{businessModel}</p>
          )}
        </div>
      )}

      {qualification && <SectorQualificationCard qualification={qualification} />}

      {hasPersonalization && (
        <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Lightbulb className="size-3.5" aria-hidden="true" />
            Intelligence Snapshot
          </p>
          <EvidenceStack
            fact={whyContact || likelyProblem || 'No specific evidence surfaced yet.'}
            inference={[whyContact && likelyProblem ? likelyProblem : null, whyNow].filter(Boolean).join(' ') || undefined}
            opportunity={whatToSell || undefined}
            opportunityMeta={openingAngle || undefined}
          />
        </div>
      )}

      <BusinessProfileSection profile={businessProfile} />
      <RecentNewsSection items={recentActivity} />
    </div>
  )
}

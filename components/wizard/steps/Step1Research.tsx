'use client'

// Step 1 — Research. Bundles the core company brief plus the audit/summary
// sections that close out the report (Research Quality, Personalization
// Summary) — these are informational tail content, not separate pipeline
// stages, so they belong at the end of step 1 rather than implying a 5th
// or 6th step that doesn't exist in this wizard's scope.

import {
  getResearchCardData,
  ExportToolbar,
  AISynthesisFailureBanner,
  ResearchHero,
  BusinessProfileSection,
  RecentNewsSection,
  PainPointsAndOpportunitiesSection,
  ResearchQualitySection,
  PersonalizationSummarySection,
  OutreachDraftSection,
} from '@/app/admin/intelligence-lab/ResearchCard'
import type { RunResult } from '@/app/admin/intelligence-lab/_types'

export function Step1Research({ result }: { result: RunResult }) {
  const data = getResearchCardData(result)
  if (!data) return null

  const {
    companyName, industry, subIndustry, summary, businessModel, confidence, signalCount,
    recentActivity, painPoints, opportunities, aiSynthesisFailed, aiSynthesisFailureReason,
    businessProfile, openingAngle, whatToSell, whyNow, outreachDraft, matchedProofPoint,
    facts, briefInput, briefExtras,
  } = data

  return (
    <div className="space-y-3">
      <ExportToolbar briefInput={briefInput} briefExtras={briefExtras} />
      <AISynthesisFailureBanner failed={aiSynthesisFailed} reason={aiSynthesisFailureReason} />
      <ResearchHero
        companyName={companyName}
        industry={industry}
        subIndustry={subIndustry}
        summary={summary}
        businessModel={businessModel}
        confidence={confidence}
        signalCount={signalCount}
        painPointsCount={painPoints.length}
        opportunitiesCount={opportunities.length}
        facts={facts}
      />
      <BusinessProfileSection profile={businessProfile} />
      <RecentNewsSection items={recentActivity} />
      <PainPointsAndOpportunitiesSection
        painPoints={painPoints}
        opportunities={opportunities}
        aiSynthesisFailed={aiSynthesisFailed}
      />
      <ResearchQualitySection quality={data.researchQuality} />
      <PersonalizationSummarySection openingAngle={openingAngle} whatToSell={whatToSell} whyNow={whyNow} />
      <OutreachDraftSection draft={outreachDraft} matchedProofPoint={matchedProofPoint} />
    </div>
  )
}

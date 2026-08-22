// ============================================================
// Company Research Card — renders one Demaze intelligence-layer result
// ============================================================
// Recent Signals -> What This Suggests -> Potential Pain Points -> Demaze
// Opportunity -> Why Contact Now, per the intelligence-layer spec. No
// mention of the underlying search/data providers anywhere in this file.
// ============================================================

import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { SectorQualificationCard } from '@/app/admin/auto-gtm/SectorQualificationCard'
import { qualifyDiscoveredCompany, type DiscoveredCompanyFirmographics } from '@/lib/sector-playbook/qualify-discovery'
import type { CompanyResearchResult, SignalConfidence, SignalRecency } from '@/lib/research/company-signals'

const RECENCY_LABEL: Record<SignalRecency, string> = {
  very_recent: 'Very recent',
  recent: 'Recent',
  older: 'Older',
}

const CONFIDENCE_CLASS: Record<SignalConfidence, string> = {
  high: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30',
  medium: 'bg-signal-medium/10 text-signal-medium border border-signal-medium/30',
  low: 'bg-muted-foreground/10 text-muted-foreground border border-border',
}

export function CompanyResearchCard({ result, firmographics }: { result: CompanyResearchResult; firmographics?: DiscoveredCompanyFirmographics }) {
  // Computed even when result.error is set below (hooks must run
  // unconditionally) — qualifyDiscoveredCompany() degrades safely on an
  // empty result (no signals/opportunities), same as every other branch here.
  const qualification = useMemo(() => qualifyDiscoveredCompany(firmographics ?? {}, result), [firmographics, result])

  if (result.error) {
    return <p className="text-destructive text-xs">Research failed: {result.error}</p>
  }

  const hasNothing = result.signals.length === 0 && !result.whyContactNow

  return (
    <div className="space-y-4 text-sm">
      <SectorQualificationCard qualification={qualification} companyFitLabel="Data profile" />

      <section>
        <h4 className="text-foreground/90 text-xs font-semibold uppercase tracking-wide mb-2">Recent Signals</h4>
        {result.signals.length === 0 ? (
          <p className="text-muted-foreground/70 text-xs">No significant recent public signals found.</p>
        ) : (
          <ol className="space-y-2.5">
            {result.signals.map((s, i) => (
              <li key={i} className="rounded-lg border border-border bg-background/50 px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-foreground text-xs font-medium">{s.title}</span>
                  <Badge className={`text-[10px] ${CONFIDENCE_CLASS[s.confidence]}`}>{s.confidence} confidence</Badge>
                  <span className="text-muted-foreground/60 text-[10px]">{RECENCY_LABEL[s.recency]}{s.date ? ` · ${s.date}` : ''}</span>
                </div>
                <p className="text-muted-foreground/90 text-xs mt-1">{s.description}</p>
                {s.sourceUrl && (
                  <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-[11px] hover:underline mt-1 inline-block truncate max-w-full">
                    {s.sourceName || s.sourceUrl}
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {result.whatThisSuggests && (
        <section>
          <h4 className="text-foreground/90 text-xs font-semibold uppercase tracking-wide mb-1.5">What This Suggests</h4>
          <p className="text-muted-foreground/90 text-xs">{result.whatThisSuggests}</p>
        </section>
      )}

      {result.potentialPainPoints.length > 0 && (
        <section>
          <h4 className="text-foreground/90 text-xs font-semibold uppercase tracking-wide mb-1.5">Potential Pain Points</h4>
          <ul className="list-disc list-inside space-y-0.5">
            {result.potentialPainPoints.map((p, i) => (
              <li key={i} className="text-muted-foreground/90 text-xs">{p}</li>
            ))}
          </ul>
        </section>
      )}

      {result.opportunities.length > 0 && (
        <section>
          <h4 className="text-foreground/90 text-xs font-semibold uppercase tracking-wide mb-2">Demaze Opportunity</h4>
          <div className="space-y-2.5">
            {result.opportunities.map((o, i) => (
              <div key={i} className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="text-primary text-xs font-medium">{o.service}</span>
                <p className="text-muted-foreground/90 text-xs mt-1"><span className="text-foreground/70 font-medium">Evidence: </span>{o.evidence}</p>
                <p className="text-muted-foreground/90 text-xs mt-0.5"><span className="text-foreground/70 font-medium">Why: </span>{o.opportunity}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {result.whyContactNow ? (
        <section>
          <h4 className="text-foreground/90 text-xs font-semibold uppercase tracking-wide mb-1.5">Why Contact Now?</h4>
          <p className="text-foreground/90 text-xs">{result.whyContactNow}</p>
        </section>
      ) : hasNothing ? (
        <p className="text-muted-foreground/70 text-xs">No significant recent public signals found for this company.</p>
      ) : null}
    </div>
  )
}

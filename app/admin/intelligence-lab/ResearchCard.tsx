'use client'

// ============================================================
// Research Card — shared result display
// ============================================================
// Extracted from intelligence-lab/page.tsx so run-history and
// batch-upload pages can render the same output for a saved run.
// ============================================================

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RunResult } from './_types'

export function ResearchCard({ result }: { result: RunResult }) {
  const a = result.analysisResult as Record<string, unknown> | undefined
  if (!a) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-4xl mb-4">🔍</div>
      <p className="text-zinc-400 text-sm max-w-xs">Enter a company URL above and click <strong className="text-white">Analyze</strong> to generate a research brief.</p>
    </div>
  )

  const str = (v: unknown) => (v != null && v !== '' ? String(v) : null)

  const companyName   = str(a.company_name) ?? 'Unknown Company'
  const industry      = str(a.industry) ?? ''
  const subIndustry   = str(a.sub_industry) ?? ''
  const sizeEstimate  = str(a.company_size_estimate) ?? ''
  const headquarters  = str(a.headquarters_location) ?? ''
  const summary       = str(a.company_summary) ?? ''
  const confidence    = str(a.confidence_level) ?? 'low'
  const businessModel = str(a.business_model) ?? ''

  // Recent activity (new field from SDR schema)
  const recentActivity: string[] = Array.isArray(a.recent_activity)
    ? (a.recent_activity as unknown[]).map(x => str(x)).filter(Boolean) as string[]
    : []

  // Signal quality indicator (replaces 0-10 fit score)
  const signalCount = result.extractorResult?.signals?.length ?? 0
  const fitLabel = signalCount >= 4 ? 'Strong Signals' : signalCount >= 2 ? 'Some Signals' : 'Inferred'
  const fitColor = signalCount >= 4 ? 'text-emerald-400' : signalCount >= 2 ? 'text-amber-400' : 'text-blue-400'
  const fitBg    = signalCount >= 4 ? 'bg-emerald-950/40 border-emerald-900' : signalCount >= 2 ? 'bg-amber-950/40 border-amber-900' : 'bg-blue-950/40 border-blue-900'
  const confColor = confidence === 'high' ? 'text-emerald-400' : confidence === 'medium' ? 'text-amber-400' : 'text-zinc-500'

  // Pain points — can be plain strings or objects
  const rawPainPoints = Array.isArray(a.pain_points) ? a.pain_points as unknown[] : []
  const painPoints: string[] = rawPainPoints.slice(0, 5).map(p =>
    typeof p === 'string' ? p :
    typeof p === 'object' && p !== null ? (str((p as Record<string, unknown>).title) ?? '') : ''
  ).filter(Boolean)

  const opportunities = Array.isArray(a.opportunities)
    ? (a.opportunities as Array<Record<string, unknown>>).slice(0, 4)
    : []
  const aiSynthesisFailed = a.ai_synthesis_status === 'failed'
  const aiSynthesisFailureReason = str(a.ai_synthesis_failure_reason)

  const outreachIntel = a.outreach_intelligence as (Record<string, unknown> | null)
  const openingAngle  = str(outreachIntel?.opening_angle) ?? str(a.outreach_angle) ?? ''
  const whyNow        = str(outreachIntel?.why_now)
    ?? str((a.why_now as Record<string, unknown>)?.explanation)
    ?? ''
  const whatToSell    = str((a.executive_brief as Record<string, unknown>)?.what_to_sell) ?? ''

  return (
    <div className="space-y-3 max-w-3xl">

      {/* ── AI Synthesis Failure Banner ──────────────────────── */}
      {/* Distinct from "genuinely found nothing" — the LLM narrative step itself
          broke after a retry, so pain_points/opportunities/outreach below are
          empty because they were never written, not because none exist. */}
      {aiSynthesisFailed && (
        <Card className="border border-red-900/60 bg-red-950/20">
          <CardContent className="px-5 py-3">
            <p className="text-red-400 text-sm font-semibold">⚠ AI synthesis failed — this report is incomplete</p>
            <p className="text-red-300/80 text-xs mt-1">
              The AI narrative step could not produce a valid response after a retry. Challenges,
              opportunities, and outreach angle below reflect deterministic signal data only —
              empty sections mean the AI failed to write them, not that nothing was found. Re-run
              the analysis to retry.
            </p>
            {aiSynthesisFailureReason && (
              <p className="text-red-500/60 text-[10px] mt-1.5 font-mono">{aiSynthesisFailureReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Company Header ───────────────────────────────────── */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white truncate">{companyName}</h2>
              <p className="text-zinc-400 text-sm mt-0.5">
                {[industry, subIndustry && subIndustry !== industry ? subIndustry : null]
                  .filter(Boolean).join(' · ')}
              </p>
              {(headquarters || sizeEstimate) && (
                <p className="text-zinc-600 text-xs mt-0.5">
                  {[headquarters, sizeEstimate].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className={`text-right shrink-0 rounded-lg border px-3 py-2 min-w-[90px] ${fitBg}`}>
              <div className={`text-xs font-bold ${fitColor}`}>{fitLabel}</div>
              <div className={`text-xs mt-0.5 ${confColor}`}>{confidence} confidence</div>
              <div className="text-[10px] text-zinc-600 mt-0.5">{signalCount} signal{signalCount !== 1 ? 's' : ''}</div>
            </div>
          </div>
          {summary && (
            <p className="text-zinc-300 text-sm mt-3 leading-relaxed border-t border-zinc-800 pt-3">
              {summary}
            </p>
          )}
          {businessModel && !summary.toLowerCase().includes(businessModel.toLowerCase().slice(0, 20)) && (
            <p className="text-zinc-500 text-xs mt-2 italic">{businessModel}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Recent Activity ──────────────────────────────────── */}
      {recentActivity.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Recent Activity &amp; Signals</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <ul className="space-y-1.5">
              {recentActivity.map((item, i) => (
                <li key={i} className="text-zinc-300 text-sm flex gap-2">
                  <span className="text-blue-500 shrink-0 mt-0.5">●</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Challenges + Opportunities ───────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Business Challenges</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {painPoints.length > 0 ? (
              <ul className="space-y-2">
                {painPoints.map((p, i) => (
                  <li key={i} className="text-zinc-300 text-sm flex gap-2">
                    <span className="text-red-500 shrink-0 mt-0.5">▸</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-600 text-xs italic">
                {aiSynthesisFailed ? 'AI synthesis failed — see banner above.' : 'No challenges identified — try a fresh scrape.'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Demaze Opportunities</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {opportunities.length > 0 ? (
              <ul className="space-y-2.5">
                {opportunities.map((o, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <span className="text-emerald-500 shrink-0 mt-0.5">▸</span>
                    <div>
                      <span className="text-zinc-200 font-medium">{str(o.title)}</span>
                      {str(o.description) && (
                        <p className="text-zinc-500 text-xs mt-0.5 leading-relaxed">{str(o.description)}</p>
                      )}
                      {str(o.entry_point) && (
                        <p className="text-zinc-600 text-[10px] mt-0.5">Entry: {str(o.entry_point)}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-600 text-xs italic">
                {aiSynthesisFailed ? 'AI synthesis failed — see banner above.' : 'No opportunities identified — try a fresh scrape.'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Outreach Angle ───────────────────────────────────── */}
      {(openingAngle || whatToSell) && (
        <Card className="border border-indigo-900/60 bg-indigo-950/20">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Outreach Angle</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4 space-y-3">
            {openingAngle && (
              <p className="text-zinc-200 text-sm leading-relaxed border-l-2 border-indigo-600 pl-3">
                &ldquo;{openingAngle}&rdquo;
              </p>
            )}
            <div className="grid grid-cols-1 gap-1.5 text-xs">
              {whatToSell && (
                <div>
                  <span className="text-zinc-500 uppercase tracking-wider font-medium">Lead with: </span>
                  <span className="text-zinc-300">{whatToSell}</span>
                </div>
              )}
              {whyNow && (
                <div>
                  <span className="text-zinc-500 uppercase tracking-wider font-medium">Why now: </span>
                  <span className="text-zinc-400">{whyNow}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

'use client'

// ============================================================
// SalesStrategyStep — Auto Flow step 2
// ============================================================
// Sits between Research and Decision Makers. Turns the just-completed
// research into a reviewable, editable Sales Intelligence recommendation
// (industry / problem / Demaze capability / positioning / case study /
// recommended roles / CTA) — see lib/sales-knowledge/matcher.ts for how
// this is computed, and CLAUDE.md's Sales Intelligence Layer entry for the
// full spec.
//
// Always skippable — "Continue" (rendered by page.tsx's shared nextAction,
// not this component) works immediately whether or not this step was ever
// generated or edited. AI recommends, the user decides; nothing here is a
// hard gate.
//
// Every field auto-saves on edit via a PATCH (no separate Save button,
// matching this app's other inline-edit conventions) — see
// useAutoGtmFlow.ts's updateSalesIntelligence. "Regenerate" is a distinct,
// confirmed action that discards any edits made here, since it fully
// replaces recommended_* (and resets active_* back to unset).
// ============================================================

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { GuideNote } from '@/components/ui/guide-note'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Sparkles, RefreshCw } from 'lucide-react'
import type {
  SalesIntelligenceRow,
  SalesKnowledgeIndustry,
  SalesKnowledgeProblem,
  SalesKnowledgeCapability,
  SalesKnowledgeCaseStudy,
  ConfidenceTier,
} from '@/lib/sales-knowledge/types'

const TIER_INFO: Record<ConfidenceTier, { label: string; className: string }> = {
  confirmed_fact: { label: 'Confirmed by research', className: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30' },
  research_supported_signal: { label: 'Research-supported', className: 'bg-primary/10 text-primary border border-primary/40' },
  industry_pattern: { label: 'Industry pattern', className: 'bg-signal-medium/10 text-signal-medium border border-signal-medium/30' },
  hypothesis: { label: 'Hypothesis, not confirmed', className: 'bg-muted text-muted-foreground border border-border' },
}

interface KnowledgeLists {
  industries: SalesKnowledgeIndustry[]
  problems: SalesKnowledgeProblem[]
  capabilities: SalesKnowledgeCapability[]
  caseStudies: SalesKnowledgeCaseStudy[]
}

interface Props {
  companyName: string
  salesIntelligence: SalesIntelligenceRow | null
  loading: boolean
  knowledgeConfigured: boolean | null
  onGenerate: () => void
  onUpdate: (patch: Record<string, unknown>) => void
}

export function SalesStrategyStep({ companyName, salesIntelligence, loading, knowledgeConfigured, onGenerate, onUpdate }: Props) {
  const [knowledge, setKnowledge] = useState<KnowledgeLists>({ industries: [], problems: [], capabilities: [], caseStudies: [] })
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const [i, p, c, cs] = await Promise.all([
          fetch('/api/admin/sales-knowledge/industries').then(r => r.json()),
          fetch('/api/admin/sales-knowledge/problems').then(r => r.json()),
          fetch('/api/admin/sales-knowledge/capabilities').then(r => r.json()),
          fetch('/api/admin/sales-knowledge/case-studies').then(r => r.json()),
        ])
        setKnowledge({
          industries: i.success ? i.industries : [],
          problems: p.success ? p.problems : [],
          capabilities: c.success ? c.capabilities : [],
          caseStudies: cs.success ? cs.caseStudies : [],
        })
      } catch {
        // Best-effort — dropdowns just stay empty, doesn't block the step.
      }
    })()
  }, [])

  // Not generated yet this session, and not currently generating.
  if (!salesIntelligence && !loading) {
    if (knowledgeConfigured === false) {
      return (
        <div className="space-y-4">
          <GuideNote>
            <p>
              Sales Knowledge hasn&apos;t been configured yet. You can continue without it, or add industries,
              problems, capabilities, and case studies in{' '}
              <a className="underline hover:text-foreground" href="/admin/outbound/sales-knowledge" target="_blank" rel="noreferrer">
                Sales Knowledge
              </a>{' '}
              first.
            </p>
          </GuideNote>
        </div>
      )
    }
    return (
      <Card className="border-border bg-card">
        <CardContent className="px-5 py-6 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground max-w-sm">
            See how Demaze should position itself for {companyName || 'this company'}, based on research and the
            Sales Knowledge playbook.
          </p>
          <Button onClick={onGenerate}>
            <Sparkles className="size-3.5" /> Generate Sales Strategy
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (loading && !salesIntelligence) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Spinner className="size-4" /> Working out the best sales angle…
      </div>
    )
  }

  if (!salesIntelligence) return null

  const active = {
    industry: salesIntelligence.active_industry_slug ?? salesIntelligence.recommended_industry_slug ?? undefined,
    problem: salesIntelligence.active_problem_slug ?? salesIntelligence.recommended_problem_slug ?? undefined,
    capability: salesIntelligence.active_capability_slug ?? salesIntelligence.recommended_capability_slug ?? undefined,
    caseStudyIds: salesIntelligence.active_case_study_ids ?? salesIntelligence.recommended_case_study_ids,
    cta: salesIntelligence.active_cta ?? salesIntelligence.recommended_cta ?? '',
    positioning: salesIntelligence.active_positioning_text ?? salesIntelligence.positioning_text ?? '',
  }
  const roles = salesIntelligence.active_roles ?? salesIntelligence.recommended_roles

  if (!salesIntelligence.recommended_problem_slug && !active.problem) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Sparkles}
          title="No confident recommendation found"
          description="Nothing in the research matched the Sales Knowledge playbook closely enough. You can still continue, or add more content to Sales Knowledge and regenerate."
        />
        <Button variant="outline" size="sm" onClick={onGenerate} disabled={loading}>
          {loading ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />} Regenerate
        </Button>
      </div>
    )
  }

  const tierInfo = salesIntelligence.confidence_tier ? TIER_INFO[salesIntelligence.confidence_tier] : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Recommended Sales Angle</h3>
          <div className="flex items-center gap-1.5 mt-1">
            {tierInfo && <Badge className={`text-[10px] ${tierInfo.className}`}>{tierInfo.label}</Badge>}
            {salesIntelligence.is_overridden && <Badge variant="outline" className="text-[10px]">Edited by you</Badge>}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setConfirmRegenerate(true)} disabled={loading}>
          {loading ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />} Regenerate
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title="Regenerate Sales Strategy?"
        description="This replaces the current recommendation and discards any edits made here."
        confirmLabel="Regenerate"
        onConfirm={() => { setConfirmRegenerate(false); onGenerate() }}
      />

      <Card className="border-border bg-card">
        <CardContent className="px-5 py-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Industry</label>
              <Select value={active.industry} onValueChange={v => onUpdate({ active_industry_slug: v })}>
                <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  {knowledge.industries.map(i => (
                    <SelectItem key={i.slug} value={i.slug}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Demaze capability</label>
              <Select value={active.capability} onValueChange={v => onUpdate({ active_capability_slug: v })}>
                <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  {knowledge.capabilities.map(c => (
                    <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Primary problem</label>
            <Select value={active.problem} onValueChange={v => onUpdate({ active_problem_slug: v })}>
              <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
              <SelectContent>
                {knowledge.problems.map(p => (
                  <SelectItem key={p.slug} value={p.slug}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {salesIntelligence.reasoning?.problem && (
              <p className="text-xs text-muted-foreground/80 mt-1">Why: {salesIntelligence.reasoning.problem}</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Recommended positioning</label>
            <Textarea
              value={active.positioning}
              onChange={e => onUpdate({ active_positioning_text: e.target.value })}
              placeholder="How Demaze should frame itself to this company"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Recommended decision makers</label>
            <div className="flex flex-wrap gap-1.5">
              {roles.length === 0 ? (
                <span className="text-xs text-muted-foreground/60">None recommended</span>
              ) : (
                roles.map(r => <Badge key={r} variant="secondary">{r}</Badge>)
              )}
            </div>
            {salesIntelligence.reasoning?.roles && (
              <p className="text-xs text-muted-foreground/80">{salesIntelligence.reasoning.roles}</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Recommended call to action</label>
            <Textarea value={active.cta} onChange={e => onUpdate({ active_cta: e.target.value })} placeholder="A low-friction next step" />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Relevant proof</label>
            {active.caseStudyIds.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">No directly matching case study found.</p>
            ) : (
              <div className="space-y-2">
                {active.caseStudyIds.map(id => {
                  const cs = knowledge.caseStudies.find(c => c.id === id)
                  if (!cs) return null
                  return (
                    <div key={id} className="rounded-lg border border-border bg-accent/20 px-3 py-2">
                      <p className="text-xs font-medium text-foreground">{cs.title}</p>
                      <p className="text-xs text-muted-foreground/80">
                        {cs.provenance === 'named_client' ? cs.client : `Composite: ${cs.client}`}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
            {salesIntelligence.reasoning?.case_study && (
              <p className="text-xs text-muted-foreground/80">{salesIntelligence.reasoning.case_study}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

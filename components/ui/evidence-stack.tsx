import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================
// EvidenceStack - Demaze's core "why does it think this?" primitive.
// Evidence (fact, sourced) -> Inference (what it implies) ->
// Opportunity (Demaze service it points to). Any row may be omitted
// (e.g. an opportunity with no distinct inference beyond the evidence
// itself) - never render a placeholder for a row with nothing real to say.
// ============================================================

type EvidenceRowKind = 'fact' | 'inference' | 'opportunity'

const KIND_LABEL: Record<EvidenceRowKind, string> = {
  fact: 'EVIDENCE',
  inference: 'INFERENCE',
  opportunity: 'OPPORTUNITY',
}

// Tailwind's compiler needs static class strings - a template-built
// `bg-[var(--color-evidence-${kind})]` would never be picked up, so each
// kind gets its own literal class here instead.
const KIND_DOT: Record<EvidenceRowKind, string> = {
  fact: 'bg-evidence-fact',
  inference: 'bg-evidence-inference',
  opportunity: 'bg-evidence-opportunity',
}
const KIND_TEXT: Record<EvidenceRowKind, string> = {
  fact: 'text-evidence-fact',
  inference: 'text-evidence-inference',
  opportunity: 'text-evidence-opportunity',
}

function EvidenceRow({
  kind,
  children,
  meta,
}: {
  kind: EvidenceRowKind
  children: React.ReactNode
  meta?: React.ReactNode
}) {
  return (
    <div className="flex gap-3 pl-0.5">
      <div className={cn('mt-[3px] size-1.5 shrink-0 rounded-full', KIND_DOT[kind])} />
      <div className="min-w-0 flex-1">
        <div className={cn('text-[10px] font-semibold tracking-[0.08em]', KIND_TEXT[kind])}>
          {KIND_LABEL[kind]}
        </div>
        <div className="mt-0.5 text-sm leading-snug text-foreground/90">{children}</div>
        {meta && <div className="mt-1 text-xs text-muted-foreground/70">{meta}</div>}
      </div>
    </div>
  )
}

export function EvidenceStack({
  fact,
  factMeta,
  inference,
  opportunity,
  opportunityMeta,
  className,
}: {
  fact: React.ReactNode
  factMeta?: React.ReactNode
  inference?: React.ReactNode
  opportunity?: React.ReactNode
  opportunityMeta?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-3 border-l border-border/70 pl-3', className)}>
      <EvidenceRow kind="fact" meta={factMeta}>{fact}</EvidenceRow>
      {inference && <EvidenceRow kind="inference">{inference}</EvidenceRow>}
      {opportunity && <EvidenceRow kind="opportunity" meta={opportunityMeta}>{opportunity}</EvidenceRow>}
    </div>
  )
}

// Compact source attribution row - replaces raw URL dumps.
// icon defaults to a generic external-link glyph via the caller.
export function SourceRow({
  icon: Icon,
  label,
  date,
  href,
}: {
  icon: LucideIcon
  label: string
  date?: string
  href?: string
}) {
  const content = (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/60">
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="min-w-0 flex-1 truncate text-foreground/90">{label}</span>
      {date && <span className="shrink-0 text-xs text-muted-foreground/60">{date}</span>}
    </div>
  )
  if (!href) return content
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="block">
      {content}
    </a>
  )
}

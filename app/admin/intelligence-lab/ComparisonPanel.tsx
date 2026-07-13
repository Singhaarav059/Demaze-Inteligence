'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RunResult } from './_types'

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

export function ComparisonPanel({ a, b }: { a: RunResult | null; b: RunResult | null }) {
  if (!a && !b) return <EmptyState message="Save two analyses to slot A and B to compare them." />

  const str = (r: RunResult | null, key: string) => {
    const ar = r?.analysisResult as Record<string, unknown> | undefined
    if (!ar) return '—'
    const v = ar[key]
    return v != null && v !== '' ? String(v) : '—'
  }

  const count = (r: RunResult | null, key: string) => {
    const ar = r?.analysisResult as Record<string, unknown> | undefined
    const v = ar?.[key]
    return Array.isArray(v) ? String(v.length) : '—'
  }

  // Aligned to the locked 5-field output schema (no legacy scores).
  const rows: Array<{ label: string; fn: (r: RunResult | null) => string }> = [
    { label: 'Company', fn: (r) => str(r, 'company_name') },
    { label: 'Industry', fn: (r) => str(r, 'industry') },
    { label: 'Confidence', fn: (r) => str(r, 'confidence_level') },
    { label: 'Pain points', fn: (r) => count(r, 'pain_points') },
    { label: 'AI opportunities', fn: (r) => count(r, 'opportunities') },
    { label: 'Recent news', fn: (r) => count(r, 'recent_activity') },
    { label: 'Signals detected', fn: (r) => String(r?.extractorResult?.signals.length ?? '—') },
  ]

  return (
    <Card className="border-border bg-card">
      <CardHeader className="px-4 pb-2 pt-4">
        <CardTitle className="text-sm text-foreground/90">Side-by-side comparison</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4 text-left font-normal text-muted-foreground">Metric</th>
                <th className="py-2 pr-4 text-left font-medium text-muted-foreground">Slot A</th>
                <th className="py-2 text-left font-medium text-muted-foreground">Slot B</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, fn }) => (
                <tr key={label} className="border-b border-border/50">
                  <td className="py-1.5 pr-4 text-muted-foreground">{label}</td>
                  <td className="py-1.5 pr-4 text-foreground/90">{fn(a)}</td>
                  <td className="py-1.5 text-foreground/90">{fn(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

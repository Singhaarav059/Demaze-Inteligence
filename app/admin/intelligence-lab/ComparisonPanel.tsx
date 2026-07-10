'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RunResult } from './_types'

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-6 py-12 text-center">
      <p className="text-zinc-500 text-sm">{message}</p>
    </div>
  )
}

export function ComparisonPanel({ a, b }: { a: RunResult | null; b: RunResult | null }) {
  if (!a && !b) return <EmptyState message="Save two analyses to slot A and B to compare them." />

  const getVal = (r: RunResult | null, key: string) => {
    const ar = r?.analysisResult
    if (!ar) return '—'
    const v = (ar as Record<string, unknown>)[key]
    if (v == null) return '—'
    if (typeof v === 'object' && v !== null && 'value' in v) return String((v as Record<string, unknown>).value)
    return String(v)
  }

  const rows: Array<{ label: string; key?: string; fn?: (r: RunResult | null) => string }> = [
    { label: 'Company Fit',       key: 'company_fit' },
    { label: 'Automation Opp',    key: 'automation_opportunity' },
    { label: 'Why Now',           key: 'why_now_score' },
    { label: 'Outreach Priority', key: 'outreach_priority_score' },
    { label: 'Confidence',        key: 'confidence_level' },
    { label: 'Signals detected',  fn: (r) => String(r?.extractorResult?.signals.length ?? '—') },
  ]

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm text-zinc-300">Side-by-side comparison</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left py-2 pr-4 text-zinc-500 font-normal">Metric</th>
                <th className="text-left py-2 pr-4 text-zinc-400 font-medium">Slot A</th>
                <th className="text-left py-2 text-zinc-400 font-medium">Slot B</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, key, fn }) => {
                const valA = fn ? fn(a) : getVal(a, key!)
                const valB = fn ? fn(b) : getVal(b, key!)
                return (
                  <tr key={label} className="border-b border-zinc-800/50">
                    <td className="py-1.5 pr-4 text-zinc-500">{label}</td>
                    <td className="py-1.5 pr-4 text-zinc-300">{valA}</td>
                    <td className="py-1.5 text-zinc-300">{valB}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

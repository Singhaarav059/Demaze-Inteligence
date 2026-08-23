// ============================================================
// BarTrend — compact daily-activity bar chart
// ============================================================
// Same "no charting dependency" precedent as sparkline.tsx: plain inline
// SVG, dark background, minimal axes. Callers gate render on real,
// sufficient data via lib/analytics/daily-counts.ts's
// hasSufficientTrendData() — this component renders whatever it's given.
// ============================================================

import { useId } from 'react'
import { cn } from '@/lib/utils'
import type { DailyCount } from '@/lib/analytics/daily-counts'

export function BarTrend({
  data,
  className,
  label,
}: {
  data: DailyCount[]
  className?: string
  label: string
}) {
  const gradientId = useId()
  const w = 240
  const h = 64
  const max = Math.max(1, ...data.map(d => d.count))
  const gap = 2
  const barWidth = data.length > 0 ? Math.max(1, w / data.length - gap) : w

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn('h-16 w-full text-primary', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {data.map((d, i) => {
        const barH = Math.max(d.count > 0 ? 2 : 0, (d.count / max) * (h - 2))
        const x = i * (barWidth + gap)
        const y = h - barH
        return (
          <rect key={i} x={x} y={y} width={barWidth} height={barH} rx={1.5} fill={`url(#${gradientId})`}>
            <title>{`${d.date}: ${d.count}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

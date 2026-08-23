'use client'

// ============================================================
// Sparkline — a compact, subtle trend line
// ============================================================
// Per the redesign brief's chart-style guidance: compact, dark background,
// thin lines, minimal axes, no gridlines, tooltip on hover. Plain inline
// SVG, no charting dependency — the data shape is tiny (a handful of daily
// buckets), a real charting library would be pure overhead here.
//
// Callers are responsible for gating render on real, sufficient data via
// lib/analytics/daily-counts.ts's hasSufficientTrendData() — this component
// renders whatever it's given, it does not itself decide "is this enough
// data to show."
// ============================================================

import { useId } from 'react'
import { cn } from '@/lib/utils'

export interface SparklinePoint {
  date: string
  count: number
}

export function Sparkline({
  data,
  className,
  label,
}: {
  data: SparklinePoint[]
  className?: string
  label: string
}) {
  const gradientId = useId()
  const w = 240
  const h = 36
  const max = Math.max(1, ...data.map(d => d.count))
  const stepX = data.length > 1 ? w / (data.length - 1) : w

  const points = data.map((d, i) => ({
    x: i * stepX,
    y: h - (d.count / max) * (h - 4) - 2,
    d,
  }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn('h-9 w-full text-primary', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.d.count > 0 ? 1.6 : 0} fill="currentColor">
          <title>{`${p.d.date}: ${p.d.count}`}</title>
        </circle>
      ))}
    </svg>
  )
}

'use client'

// ============================================================
// HowItWorksScrolly - pinned scroll-driven step sequence
// ============================================================
// Desktop/tablet (sm+): a tall (180vh) scroll region with a sticky h-screen
// inner panel. As the user scrolls through it, each of the 3 steps
// cross-fades/scales in based on scroll progress within the region -
// classic scrollytelling ("pin and animate through" rather than "reveal
// and move on"). Deliberately hardcoded for exactly 3 steps: calling
// useTransform per-step inside a .map() would violate rules-of-hooks
// (hook calls must be static, not loop-generated), so each step's
// transforms are written out explicitly rather than generated generically.
//
// Mobile (<sm): pinning a multi-viewport-tall region on a small viewport with dynamic
// browser chrome is janky and hard to verify, so mobile gets the original
// static stacked-card layout instead (no scroll-linked motion at all).
//
// Reduced-motion: MotionConfig's ancestor `reducedMotion="user"` (see
// MotionConfigProvider) only flattens `animate`/`whileInView`-driven
// transitions, not raw scroll-linked `useTransform` values - so this
// component checks `useReducedMotion()` itself and, when set, renders the
// same static stacked layout as mobile instead of pinning+animating.
// ============================================================

import { useRef } from 'react'
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from 'framer-motion'

export interface HowItWorksStep {
  number: string
  title: string
  description: string
  color: string
}

const FADE = 0.08 // fraction of total scroll progress used for each cross-fade

function StaticSteps({ steps }: { steps: HowItWorksStep[] }) {
  return (
    <div className="grid grid-cols-1 sm:hidden gap-6">
      {steps.map((step) => (
        <div key={step.number} className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center`}>
            <span className="text-white font-bold text-sm">{step.number}</span>
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function ScrollyStep({
  step,
  opacity,
  scale,
  y,
}: {
  step: HowItWorksStep
  opacity: MotionValue<number>
  scale: MotionValue<number>
  y: MotionValue<number>
}) {
  return (
    <motion.div
      style={{ opacity, scale, y }}
      className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
    >
      <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center mb-8 shadow-lg`}>
        <span className="text-white font-bold text-xl">{step.number}</span>
      </div>
      <h3 className="text-2xl sm:text-3xl font-bold text-foreground max-w-lg">{step.title}</h3>
      <p className="text-muted-foreground text-base sm:text-lg leading-relaxed max-w-md mt-4">{step.description}</p>
    </motion.div>
  )
}

export function HowItWorksScrolly({ steps }: { steps: [HowItWorksStep, HowItWorksStep, HowItWorksStep] }) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  })

  // Step boundaries for 3 equal segments: [0, 1/3, 2/3, 1]
  const b1 = 1 / 3
  const b2 = 2 / 3

  const opacity0 = useTransform(scrollYProgress, [0, b1 - FADE, b1], [1, 1, 0])
  const scale0 = useTransform(scrollYProgress, [0, b1 - FADE, b1], [1, 1, 0.96])
  const y0 = useTransform(scrollYProgress, [0, b1 - FADE, b1], [0, 0, -16])

  const opacity1 = useTransform(scrollYProgress, [b1 - FADE, b1, b2 - FADE, b2], [0, 1, 1, 0])
  const scale1 = useTransform(scrollYProgress, [b1 - FADE, b1, b2 - FADE, b2], [0.96, 1, 1, 0.96])
  const y1 = useTransform(scrollYProgress, [b1 - FADE, b1, b2 - FADE, b2], [16, 0, 0, -16])

  const opacity2 = useTransform(scrollYProgress, [b2 - FADE, b2, 1], [0, 1, 1])
  const scale2 = useTransform(scrollYProgress, [b2 - FADE, b2, 1], [0.96, 1, 1])
  const y2 = useTransform(scrollYProgress, [b2 - FADE, b2, 1], [16, 0, 0])

  const dotScale0 = useTransform(scrollYProgress, [0, b1 - FADE, b1], [1.3, 1.3, 1])
  const dotScale1 = useTransform(scrollYProgress, [b1 - FADE, b1, b2 - FADE, b2], [1, 1.3, 1.3, 1])
  const dotScale2 = useTransform(scrollYProgress, [b2 - FADE, b2, 1], [1, 1.3, 1.3])

  if (reducedMotion) {
    return (
      <div className="max-w-5xl mx-auto px-6">
        <div className="hidden sm:grid grid-cols-3 gap-6">
          {steps.map((step) => (
            <div key={step.number} className="rounded-2xl border border-border bg-card p-6 space-y-4">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center`}>
                <span className="text-white font-bold text-sm">{step.number}</span>
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
        <StaticSteps steps={steps} />
      </div>
    )
  }

  return (
    <>
      {/* Mobile fallback - no pinning, no scroll-linked motion */}
      <div className="max-w-5xl mx-auto px-6">
        <StaticSteps steps={steps} />
      </div>

      {/* Desktop/tablet - pinned scrollytelling */}
      <div ref={sectionRef} className="hidden sm:block relative h-[180vh]">
        <div className="sticky top-0 h-screen flex items-center overflow-hidden">
          <div className="relative w-full max-w-2xl mx-auto h-64">
            <ScrollyStep step={steps[0]} opacity={opacity0} scale={scale0} y={y0} />
            <ScrollyStep step={steps[1]} opacity={opacity1} scale={scale1} y={y1} />
            <ScrollyStep step={steps[2]} opacity={opacity2} scale={scale2} y={y2} />
          </div>

          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-3">
            <motion.span style={{ scale: dotScale0 }} className="w-2 h-2 rounded-full bg-primary" />
            <motion.span style={{ scale: dotScale1 }} className="w-2 h-2 rounded-full bg-primary" />
            <motion.span style={{ scale: dotScale2 }} className="w-2 h-2 rounded-full bg-primary" />
          </div>
        </div>
      </div>
    </>
  )
}

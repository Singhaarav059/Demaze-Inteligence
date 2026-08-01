'use client'

// ============================================================
// ScrollReveal — fade/slide-in-on-scroll for the public landing page
// ============================================================
// Thin motion.div wrapper: fades and slides an element up the first time
// it enters the viewport, then leaves it alone (`once: true` — never
// re-triggers on scroll-back, avoids a distracting flicker on a long page).
// Reduced-motion is handled by the MotionConfig `reducedMotion="user"`
// ancestor (see MotionConfigProvider) rather than here, same as every
// other framer-motion usage in this codebase — no per-component opt-in.
//
// Optional `parallax` prop adds a continuous scroll-linked y-offset on TOP
// of the one-shot reveal — the two don't fight over the same property
// because the reveal only ever animates `opacity` (not `y`) when parallax
// is active; `y` is driven exclusively by the scroll-linked MotionValue in
// that case. `useTransform`/`useScroll` are raw scroll-linked values, not
// gated by MotionConfig's reducedMotion, so this component checks
// `useReducedMotion()` itself and disables the parallax offset (falls back
// to the plain reveal) when set.
// ============================================================

import { useRef } from 'react'
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion'

interface ScrollRevealProps {
  children: React.ReactNode
  delay?: number
  className?: string
  /** Max px of continuous scroll-linked vertical drift. Omit for the plain reveal. */
  parallax?: number
}

export function ScrollReveal({ children, delay = 0, className, parallax }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const parallaxY = useTransform(scrollYProgress, [0, 1], parallax ? [parallax, -parallax] : [0, 0])

  const active = !!parallax && !reducedMotion

  return (
    <motion.div
      ref={ref}
      className={className}
      style={active ? { y: parallaxY } : undefined}
      initial={active ? { opacity: 0 } : { opacity: 0, y: 24 }}
      whileInView={active ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2, margin: '0px 0px -80px 0px' }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

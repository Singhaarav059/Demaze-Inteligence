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
// ============================================================

import { motion } from 'framer-motion'

interface ScrollRevealProps {
  children: React.ReactNode
  delay?: number
  className?: string
}

export function ScrollReveal({ children, delay = 0, className }: ScrollRevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2, margin: '0px 0px -80px 0px' }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

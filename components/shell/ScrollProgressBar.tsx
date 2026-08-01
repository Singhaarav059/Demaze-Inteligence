'use client'

// ============================================================
// ScrollProgressBar — thin whole-page scroll indicator
// ============================================================
// Orientation aid for a long, now scrollytelling-heavy landing page: a
// 2px bar under the sticky header that fills left-to-right with overall
// scroll progress. Plain `useScroll()` (no target) tracks window/document
// scroll directly. A light spring smooths the fill without adding the
// kind of continuous motion prefers-reduced-motion cares about — but we
// still collapse it to the raw (unsprung) value when reduced motion is
// set, same discipline as every other scroll-linked value in this file.
// ============================================================

import { motion, useScroll, useSpring, useReducedMotion } from 'framer-motion'

export function ScrollProgressBar() {
  const { scrollYProgress } = useScroll()
  const reducedMotion = useReducedMotion()
  const smoothed = useSpring(scrollYProgress, { stiffness: 300, damping: 40, mass: 0.2 })

  return (
    <motion.div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[60] h-[2px] bg-primary origin-left"
      style={{ scaleX: reducedMotion ? scrollYProgress : smoothed }}
    />
  )
}

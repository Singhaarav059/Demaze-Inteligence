// ============================================================
// Shared motion tokens — Framer Motion durations/easing/variants
// ============================================================
// Single source of truth so every page adopting animation uses the same
// feel instead of ad hoc per-component duration/easing values. First
// consumer: the Discover page redesign (2026-07-17); intended for reuse by
// future page passes (Research/History) rather than re-derived per file.

import type { Transition, Variants } from 'framer-motion'

export const DURATION = {
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const

// A gentle "ease-out" curve — quick start, soft landing. Used everywhere
// instead of the default linear/ease so motion reads as deliberate, not
// mechanical.
export const EASE = [0.16, 1, 0.3, 1] as const

export const springTransition: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 35,
}

// ── Reveal: a card/section appearing (step cards, panels) ──────────
export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.base, ease: EASE },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: DURATION.fast, ease: EASE },
  },
}

// ── List container: staggers its children's entrance ───────────────
export const staggerList: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05, delayChildren: 0.02 },
  },
}

// ── List item: one row entering as part of a staggered list ────────
export const listItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.fast, ease: EASE },
  },
  exit: {
    opacity: 0,
    transition: { duration: DURATION.fast, ease: EASE },
  },
}

// ── Simple crossfade: badge/label content swapping in place ────────
export const crossfade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.fast, ease: EASE } },
  exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE } },
}

// ── Expand/collapse: a details panel animating open by height instead of
// snapping. Pair with `overflow-hidden` on the animated element (framer
// motion measures and interpolates to/from `height: 'auto'` itself). ──
export const expandCollapse: Variants = {
  hidden: { height: 0, opacity: 0 },
  visible: { height: 'auto', opacity: 1, transition: { duration: DURATION.base, ease: EASE } },
  exit: { height: 0, opacity: 0, transition: { duration: DURATION.fast, ease: EASE } },
}

'use client'

// ============================================================
// MotionConfigProvider — global reduced-motion respect
// ============================================================
// Thin client-boundary wrapper so the server-component admin layout can
// still apply framer-motion's MotionConfig around the whole app shell.
// reducedMotion="user" collapses every animation in the app (Sidebar's
// active-pill slide, Discover's step transitions, Auto Flow's motion, etc)
// to instant for anyone with the OS-level "reduce motion" preference set,
// with zero visual change for everyone else — framer-motion handles this
// automatically, no per-component opt-in needed.
// ============================================================

import { MotionConfig } from 'framer-motion'

export function MotionConfigProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}

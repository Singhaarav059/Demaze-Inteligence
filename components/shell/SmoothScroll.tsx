'use client'

// ============================================================
// SmoothScroll - Lenis smooth scrolling for the public landing page
// ============================================================
// Scoped to app/page.tsx only, not the root layout - /admin routes have
// data tables, sticky headers, and dropdown/modal scroll containers that
// a global scroll-hijack could interfere with. Respects prefers-reduced-
// motion the same way MotionConfigProvider does for framer-motion: skip
// Lenis entirely and fall back to native scroll, rather than disabling
// its internal animation (Lenis has no built-in reduced-motion switch).
// ============================================================

import { useEffect, useState } from 'react'
import { ReactLenis } from 'lenis/react'

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(true)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(query.matches)
    const onChange = () => setReducedMotion(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  if (reducedMotion) return <>{children}</>

  return (
    <ReactLenis root options={{ lerp: 0.12, duration: 0.7, smoothWheel: true }}>
      {children}
    </ReactLenis>
  )
}

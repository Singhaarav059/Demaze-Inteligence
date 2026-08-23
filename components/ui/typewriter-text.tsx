'use client'

// ============================================================
// TypewriterText - reveals text word by word instead of all at once
// ============================================================
// Used for freshly-generated AI content (outreach emails, subject lines,
// follow-ups) so it reads as "being written" rather than popping in fully
// formed. Restarts whenever `text` changes (a new draft, or switching to a
// different contact's already-different draft) - re-rendering with the same
// `text` value does not replay it, since the effect only re-runs on a real
// text change.
// ============================================================

import { useEffect, useState } from 'react'

export function TypewriterText({
  text,
  intervalMs = 18,
  className,
}: {
  text: string
  intervalMs?: number
  className?: string
}) {
  const [shown, setShown] = useState(text)

  useEffect(() => {
    // Splitting on a whitespace-capturing regex keeps the whitespace tokens
    // themselves in the array, so re-joining a slice reproduces the original
    // spacing/newlines exactly instead of collapsing them.
    const tokens = text.split(/(\s+)/)
    let i = 0
    setShown('')
    const id = setInterval(() => {
      i++
      setShown(tokens.slice(0, i).join(''))
      if (i >= tokens.length) clearInterval(id)
    }, intervalMs)
    return () => clearInterval(id)
  }, [text, intervalMs])

  return <span className={className}>{shown}</span>
}

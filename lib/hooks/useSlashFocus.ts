import { useEffect } from 'react'

const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA'])

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  if (TEXT_INPUT_TAGS.has(el.tagName)) return true
  return (el as HTMLElement).isContentEditable
}

// Focuses the given input on "/" — guarded so it never hijacks a literal "/"
// typed into a field that's already focused (own input included, any other
// text input, or a contentEditable region).
export function useSlashFocus(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(document.activeElement)) return
      e.preventDefault()
      ref.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

// ============================================================
// Demaze AI Outbound Intelligence Platform
// Scrape formatting utilities — shared by the scraper pipeline
// and admin test routes.
// ============================================================

export function formatScrapedPages(pages: Array<{
  url: string
  markdown: string
  success: boolean
}>): string {
  const successfulPages = pages.filter(p => p.success && p.markdown.trim().length > 0)

  if (successfulPages.length === 0) {
    return '[No content could be extracted from this website]'
  }

  return successfulPages
    .map(page => {
      const label = new URL(page.url).pathname || '/'
      return `--- PAGE: ${label} (${page.url}) ---\n${page.markdown.trim()}`
    })
    .join('\n\n')
}

// 1 token ≈ 4 characters for English text.
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

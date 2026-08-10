// ============================================================
// Plain-text -> minimal HTML for outbound email bodies
// ============================================================
// Every generated email in this app is authored as plain text
// (lib/outbound/generation/generate-email.ts's fullText) — this only exists
// so a multipart/alternative send (see gmail-client.ts's buildMimeMessage)
// has an HTML part to carry the open-tracking pixel. Deliberately minimal:
// no styling, no images beyond the pixel, no fonts/colors — anything fancier
// reads as "marketing email" to spam filters and this is meant to look like
// a plain 1:1 message, which is the whole point of sending plain text in the
// first place.
// ============================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function plainTextToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => escapeHtml(p.trim()).replace(/\n/g, '<br>'))
    .filter(p => p.length > 0)

  return paragraphs.map(p => `<p>${p}</p>`).join('\n')
}

// ============================================================
// Outreach Content Generation — Prompts
// ============================================================
// Same anti-hallucination discipline as lib/prompts/analyze-v2.ts's
// [COMPETITOR CANDIDATES]/[ICP CANDIDATES] blocks: the model may only
// reference facts already present in the input below, never invent a fact
// about the company, a metric, or a claim not grounded in the research.
// ============================================================

import type { EmailGenerationInput, EmailDraft } from './types'

function renderInputBlock(input: EmailGenerationInput): string {
  const lines: string[] = []
  lines.push(`Person: ${input.personName}${input.titleHint ? ` (${input.titleHint})` : ''}`)
  lines.push(`Company: ${input.companyName}`)
  if (input.companySummary) lines.push(`Company summary: ${input.companySummary}`)
  if (input.painPoints.length > 0) {
    lines.push(`Pain points:\n${input.painPoints.map(p => `- ${p}`).join('\n')}`)
  }
  if (input.opportunities.length > 0) {
    lines.push(
      `Opportunities:\n${input.opportunities.map(o => `- ${o.title}${o.description ? `: ${o.description}` : ''}`).join('\n')}`
    )
  }
  if (input.recentActivity.length > 0) {
    lines.push(`Recent activity:\n${input.recentActivity.map(a => `- ${a}`).join('\n')}`)
  }
  if (input.openingAngle) lines.push(`Suggested opening angle: ${input.openingAngle}`)
  if (input.whatToSell) lines.push(`What to sell: ${input.whatToSell}`)
  if (input.whyNow) lines.push(`Why now: ${input.whyNow}`)
  return lines.join('\n\n')
}

const COMMON_RULES = `
Rules:
- Only reference facts, pain points, opportunities, and activity already present in the research below. Never invent a fact, metric, or claim about the company.
- If the research below is thin, write shorter and more general copy rather than fabricating specifics to fill space.
- Address the person by first name only. Do not invent a greeting title (Mr./Ms./Dr.) unless it's given.
- No corporate buzzwords ("synergy", "leverage", "circle back"). Write like a real person, not a template.
`.trim()

export function buildSubjectLinePrompt(input: EmailGenerationInput): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You write cold outreach subject lines for a B2B sales rep. You respond with strict JSON only, matching the requested schema exactly.`

  const userPrompt = `
Write 5 distinct cold-email subject lines for reaching out to the person below, based only on the research provided.

[RESEARCH]
${renderInputBlock(input)}
[END RESEARCH]

${COMMON_RULES}
- Each subject line must be different in angle (don't just reword the same one 5 times).
- Keep each under 60 characters. No emojis, no ALL CAPS, no clickbait ("You won't believe...").

Respond with JSON only, matching this exact schema:
{
  "subjects": ["...", "...", "...", "...", "..."]
}
`.trim()

  return { systemPrompt, userPrompt }
}

export function buildEmailPrompt(
  input: EmailGenerationInput,
  subjectLine: string
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You write cold outreach emails for a B2B sales rep. You respond with strict JSON only, matching the requested schema exactly.`

  const userPrompt = `
Write a cold outreach email to the person below, using the chosen subject line and the research provided.

Chosen subject line: "${subjectLine}"

[RESEARCH]
${renderInputBlock(input)}
[END RESEARCH]

${COMMON_RULES}
- Structure the email in these sections: hook (1-2 sentences opening that references something specific and real from the research), personalization (why you're reaching out to THEM specifically), painPoint (the specific problem, grounded in the research), valueProp (what's being offered, in plain terms, no hard sell), cta (a single low-friction ask — e.g. "worth 15 minutes?"), signature (a short sign-off, no fabricated name/title — just "Best," or similar).
- fullText should be all sections combined into one email exactly as it would be sent, with the subject line NOT included (subject is sent separately).
- Keep the whole email under 150 words.

Respond with JSON only, matching this exact schema:
{
  "hook": "...",
  "personalization": "...",
  "painPoint": "...",
  "valueProp": "...",
  "cta": "...",
  "signature": "...",
  "fullText": "..."
}
`.trim()

  return { systemPrompt, userPrompt }
}

export function buildFollowupPrompt(
  input: EmailGenerationInput,
  originalEmail: EmailDraft
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You write cold-outreach follow-up sequences for a B2B sales rep. You respond with strict JSON only, matching the requested schema exactly.`

  const userPrompt = `
Write a 3-email follow-up sequence for the original cold email below, to the person described in the research. Each follow-up must take a genuinely different angle from the original and from each other — do not just restate or shorten the original email. Urgency should increase slightly across the sequence (low -> medium -> high) but stay natural, never pushy or guilt-tripping.

[ORIGINAL EMAIL SENT]
${originalEmail.fullText}
[END ORIGINAL EMAIL]

[RESEARCH]
${renderInputBlock(input)}
[END RESEARCH]

${COMMON_RULES}
- Follow-up 1 (low urgency): a light nudge, maybe surfacing a different pain point or opportunity from the research than the original email used.
- Follow-up 2 (medium urgency): a different angle again — e.g. a different opportunity, a proof point, or a more direct restatement of value.
- Follow-up 3 (high urgency, but not pushy): a final, brief "should I close this out?" style message.
- Keep each follow-up under 80 words — shorter than the original.

Respond with JSON only, matching this exact schema:
{
  "followups": [
    { "sequence": 1, "angle": "short label for this angle", "urgency": "low", "subject": "...", "body": "..." },
    { "sequence": 2, "angle": "short label for this angle", "urgency": "medium", "subject": "...", "body": "..." },
    { "sequence": 3, "angle": "short label for this angle", "urgency": "high", "subject": "...", "body": "..." }
  ]
}
`.trim()

  return { systemPrompt, userPrompt }
}

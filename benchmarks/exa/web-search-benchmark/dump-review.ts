// Analysis-only, offline: dumps a compact side-by-side Tavily-vs-Exa text
// view of a chosen review subset for manual RELEVANT/IRRELEVANT/AMBIGUOUS
// classification. Not part of the benchmark's live-call path.
import fs from 'fs'

const file = process.argv[2]
const companiesArg = (process.argv[3] ?? '').split(',').filter(Boolean)
const modulesArg = (process.argv[4] ?? '').split(',').filter(Boolean)

const data = JSON.parse(fs.readFileSync(file, 'utf-8'))

const filtered = data.filter((r: any) =>
  r.module !== 'mode_comparison' && r.module !== 'cache_hit_check' &&
  (companiesArg.length === 0 || companiesArg.includes(r.company)) &&
  (modulesArg.length === 0 || modulesArg.includes(r.module)) &&
  (r.provider === 'tavily' || r.provider === 'exa')
)

const byQuery = new Map<string, any>()
for (const r of filtered) {
  const key = `${r.company}|${r.query}`
  if (!byQuery.has(key)) byQuery.set(key, { company: r.company, module: r.module, category: r.category, query: r.query })
  byQuery.get(key)[r.provider] = r.results
}

const lines: string[] = []
for (const [, g] of byQuery) {
  lines.push(`\n### [${g.company}] (${g.module}/${g.category}) "${g.query}"`)
  lines.push(`TAVILY (${(g.tavily ?? []).length}):`)
  for (const r of g.tavily ?? []) lines.push(`  - ${r.url}\n    title: ${r.title}\n    snippet: ${r.snippet.slice(0, 150).replace(/\n/g, ' ')}`)
  lines.push(`EXA (${(g.exa ?? []).length}):`)
  for (const r of g.exa ?? []) lines.push(`  - ${r.url}\n    title: ${r.title}\n    snippet: ${r.snippet.slice(0, 150).replace(/\n/g, ' ')}`)
}

const outPath = file.replace('.json', `-review-${(companiesArg.join('_') || 'all')}.txt`)
fs.writeFileSync(outPath, lines.join('\n'))
console.log(`${byQuery.size} query-groups -> ${outPath}`)

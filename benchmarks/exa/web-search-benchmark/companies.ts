// ============================================================
// Benchmark company fixtures
// ============================================================
// 4 of the 10 companies from benchmarks/exa/provider-benchmark.ts's own
// KNOWN_COMPANIES list (same real domains, same precedent) — reused rather
// than inventing a new set, and picked to cover 4 of CLAUDE.md's stated
// target verticals (Manufacturing/Industrial, large Industrial/Automotive,
// SaaS, Financial Institutions) without re-running the full 10-company set
// this phase doesn't need. 4 companies keeps total call volume reviewable
// (see PHASE1_REPORT.md's methodology note on review scope), not 5 — a
// deliberate, documented reduction from the prompt's "suggested" 5, in
// exchange for using the COMPLETE real per-category query set (not a
// trimmed sample) for every company included.
// ============================================================

export interface BenchmarkCompany {
  name: string
  domain: string
  vertical: string
}

export const BENCHMARK_COMPANIES: BenchmarkCompany[] = [
  { name: 'Ador Welding', domain: 'adorwelding.com', vertical: 'Manufacturing/Industrial' },
  { name: 'Bharat Forge', domain: 'bharatforge.com', vertical: 'Large Industrial/Automotive' },
  { name: 'Chargebee', domain: 'chargebee.com', vertical: 'SaaS' },
  { name: 'Muthoot Finance', domain: 'muthootfinance.com', vertical: 'Financial Institution' },
]

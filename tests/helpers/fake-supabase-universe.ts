// ============================================================
// Minimal in-memory fake Supabase query builder, purpose-built for
// lib/company-universe/ingestion.ts's actual call surface — a genuinely
// new fake rather than extending tests/helpers/fake-supabase.ts, which
// doesn't support .or()/.ilike()/.gte()/.lte()/.overlaps() or real
// onConflict-merge upsert semantics and is shared by other test files this
// session should not risk regressing.
//
// Faithful enough for what ingestion.ts calls, not a general Postgres/
// PostgREST simulator: .or() only parses the exact shapes ingestion.ts
// builds (col.eq.val, and(col.eq.val,col.eq.val)), .upsert() does a real
// merge-on-conflict (the actual property this suite needs to verify —
// re-run safety), everything else is a straightforward in-memory filter.
// ============================================================

type Row = Record<string, any>

function parseOrClause(clause: string): (row: Row) => boolean {
  const andMatch = clause.match(/^and\((.+)\)$/)
  if (andMatch) {
    const subClauses = andMatch[1].split(',').map(parseOrClause)
    return (row) => subClauses.every(fn => fn(row))
  }
  const [col, op, ...rest] = clause.split('.')
  const val = rest.join('.')
  if (op === 'eq') return (row) => String(row[col]) === val
  return () => false
}

class FakeUniverseQueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private filters: Array<(row: Row) => boolean> = []
  private op: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select'
  private updateData: Row | null = null
  private insertData: Row[] | null = null
  private upsertConflictCol: string[] | null = null
  private limitN: number | null = null

  constructor(private rows: Row[], private idSeed: () => string) {}

  select(_cols?: string) { return this }
  update(data: Row) { this.op = 'update'; this.updateData = data; return this }
  insert(data: Row | Row[]) { this.op = 'insert'; this.insertData = Array.isArray(data) ? data : [data]; return this }
  upsert(data: Row, opts?: { onConflict?: string }) {
    this.op = 'upsert'
    this.insertData = [data]
    this.upsertConflictCol = opts?.onConflict ? opts.onConflict.split(',') : null
    return this
  }
  delete() { this.op = 'delete'; return this }

  eq(col: string, val: any) { this.filters.push(r => r[col] === val); return this }
  in(col: string, vals: any[]) { this.filters.push(r => vals.includes(r[col])); return this }
  // NULL comparisons in real SQL never match (NULL <= x is NULL, not true)
  // — explicitly excluding null/undefined here, since JS's native `<=`/`>=`
  // coerce null to 0 and would otherwise wrongly match a genuinely-unknown
  // value against a numeric range filter.
  gte(col: string, val: any) { this.filters.push(r => r[col] !== null && r[col] !== undefined && r[col] >= val); return this }
  lte(col: string, val: any) { this.filters.push(r => r[col] !== null && r[col] !== undefined && r[col] <= val); return this }
  ilike(col: string, pattern: string) {
    const needle = pattern.replace(/%/g, '').toLowerCase()
    this.filters.push(r => typeof r[col] === 'string' && r[col].toLowerCase().includes(needle))
    return this
  }
  overlaps(col: string, vals: any[]) {
    this.filters.push(r => Array.isArray(r[col]) && r[col].some((v: any) => vals.includes(v)))
    return this
  }
  or(clauseStr: string) {
    // Split top-level commas, respecting and(...) grouping.
    const clauses: string[] = []
    let depth = 0
    let current = ''
    for (const ch of clauseStr) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { clauses.push(current); current = '' } else { current += ch }
    }
    if (current) clauses.push(current)
    const fns = clauses.map(parseOrClause)
    this.filters.push(row => fns.some(fn => fn(row)))
    return this
  }
  limit(n: number) { this.limitN = n; return this }
  order() { return this }

  private matched() {
    let m = this.rows.filter(r => this.filters.every(f => f(r)))
    if (this.limitN !== null) m = m.slice(0, this.limitN)
    return m
  }

  private execute(): { data: any; error: any } {
    if (this.op === 'update') {
      const matches = this.matched()
      matches.forEach(r => Object.assign(r, this.updateData))
      return { data: matches.map(r => ({ ...r })), error: null }
    }
    if (this.op === 'insert') {
      const items = this.insertData!.map(i => ({ id: this.idSeed(), created_at: new Date().toISOString(), ...i }))
      this.rows.push(...items)
      return { data: items.map(r => ({ ...r })), error: null }
    }
    if (this.op === 'upsert') {
      const data = this.insertData![0]
      const conflictCols = this.upsertConflictCol ?? []
      const existing = conflictCols.length > 0
        ? this.rows.find(r => conflictCols.every(c => r[c] === data[c]))
        : undefined
      if (existing) {
        Object.assign(existing, data)
        return { data: [{ ...existing }], error: null }
      }
      const item = { id: this.idSeed(), created_at: new Date().toISOString(), ...data }
      this.rows.push(item)
      return { data: [{ ...item }], error: null }
    }
    if (this.op === 'delete') {
      const matches = this.matched()
      for (const m of matches) { const idx = this.rows.indexOf(m); if (idx !== -1) this.rows.splice(idx, 1) }
      return { data: matches.map(r => ({ ...r })), error: null }
    }
    return { data: this.matched().map(r => ({ ...r })), error: null }
  }

  async maybeSingle() { const { data, error } = this.execute(); return { data: data[0] ?? null, error } }
  async single() { const { data, error } = this.execute(); return { data: data[0] ?? null, error } }

  then<T1 = { data: any; error: any }, T2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }
}

export class FakeUniverseSupabase {
  private tables: Record<string, Row[]> = {}
  private counter = 0

  seed(table: string, rows: Row[]) { this.tables[table] = rows; return this }
  table(table: string): Row[] { return this.tables[table] ?? [] }

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = []
    return new FakeUniverseQueryBuilder(this.tables[table], () => `fake_${table}_${this.counter++}`)
  }
}

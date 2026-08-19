// ============================================================
// Minimal in-memory fake of the Supabase query builder, for testing
// concurrency-sensitive claim logic without a real Postgres instance.
// ============================================================
// Faithful enough for what the send-path routes actually call: from/select/
// update/insert/eq/neq/in/gte, terminating in maybeSingle()/single() or by
// awaiting the builder directly (Supabase's builder is itself a thenable —
// this mirrors that). Not a general Supabase mock — only implements what
// these routes use.
//
// Concurrency note: JS has no real threads, so "two concurrent requests"
// racing on the same row is simulated by two async functions each awaiting
// this builder — since `await thenable` calls `thenable.then(resolve)`
// synchronously (before yielding to the microtask queue), and `execute()`
// below runs synchronously inside that `.then()`, calling this builder twice
// back-to-back (e.g. via Promise.all) faithfully reproduces the same
// read-check-write ordering guarantee an atomic `UPDATE ... WHERE` gives at
// the database level — exactly the property Step A2 needs verified.
// ============================================================

type Row = Record<string, any>

class FakeQueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private filters: Array<(row: Row) => boolean> = []
  private op: 'select' | 'update' | 'insert' | 'delete' = 'select'
  private updateData: Row | null = null
  private insertData: Row[] | null = null
  private orderCol: string | null = null
  private orderAscending = true
  private limitCount: number | null = null

  constructor(private rows: Row[], private idSeed: () => string) {}

  select(_cols?: string) {
    return this
  }
  update(data: Row) {
    this.op = 'update'
    this.updateData = data
    return this
  }
  insert(data: Row | Row[]) {
    this.op = 'insert'
    this.insertData = Array.isArray(data) ? data : [data]
    return this
  }
  // ponytail: treated as plain insert, not real onConflict-merge upsert —
  // fine for the tests that use this (existence/shape checks), upgrade if a
  // test needs real conflict-resolution semantics.
  upsert(data: Row, _opts?: { onConflict?: string }) {
    return this.insert(data)
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(col: string, val: any) {
    this.filters.push(r => r[col] === val)
    return this
  }
  neq(col: string, val: any) {
    this.filters.push(r => r[col] !== val)
    return this
  }
  in(col: string, vals: any[]) {
    this.filters.push(r => vals.includes(r[col]))
    return this
  }
  // Only the one shape this codebase actually uses (.not(col, 'is', null))
  // is supported — same "faithful enough for what these routes call"
  // discipline as the rest of this fake, not a general NOT-filter engine.
  not(col: string, _op: 'is', val: any) {
    if (val === null) this.filters.push(r => r[col] !== null && r[col] !== undefined)
    return this
  }
  gte(col: string, val: any) {
    this.filters.push(r => r[col] >= val)
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col
    this.orderAscending = opts?.ascending ?? true
    return this
  }
  limit(count: number) {
    this.limitCount = count
    return this
  }

  private matched() {
    return this.rows.filter(r => this.filters.every(f => f(r)))
  }

  private execute(): { data: any; error: any } {
    // Every branch returns CLONES, never the live row objects — a real
    // Supabase response is always a fresh deserialized JSON object, so a
    // caller mutating a table row later (e.g. an atomic claim) must never
    // retroactively change an object some earlier, already-completed query
    // already handed back (that bit a real bug-shaped test failure here:
    // an already-fetched row object silently "saw" a later update).
    if (this.op === 'update') {
      const matches = this.matched()
      matches.forEach(r => Object.assign(r, this.updateData))
      return { data: matches.map(r => ({ ...r })), error: null }
    }
    if (this.op === 'insert') {
      const items = this.insertData!.map(i => ({ id: this.idSeed(), occurred_at: new Date().toISOString(), ...i }))
      this.rows.push(...items)
      return { data: items.map(r => ({ ...r })), error: null }
    }
    if (this.op === 'delete') {
      const matches = this.matched()
      for (const m of matches) {
        const idx = this.rows.indexOf(m)
        if (idx !== -1) this.rows.splice(idx, 1)
      }
      return { data: matches.map(r => ({ ...r })), error: null }
    }
    let matched = this.matched()
    if (this.orderCol) {
      const col = this.orderCol
      const dir = this.orderAscending ? 1 : -1
      matched.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * dir)
    }
    if (this.limitCount !== null) matched = matched.slice(0, this.limitCount)
    return { data: matched.map(r => ({ ...r })), error: null }
  }

  async maybeSingle() {
    const { data, error } = this.execute()
    return { data: data[0] ?? null, error }
  }
  async single() {
    const { data, error } = this.execute()
    return { data: data[0] ?? null, error }
  }

  then<T1 = { data: any; error: any }, T2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }
}

export class FakeSupabase {
  private tables: Record<string, Row[]> = {}
  private counter = 0

  seed(table: string, rows: Row[]) {
    this.tables[table] = rows
    return this
  }

  table(table: string): Row[] {
    return this.tables[table] ?? []
  }

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = []
    return new FakeQueryBuilder(this.tables[table], () => `fake_${table}_${this.counter++}`)
  }
}

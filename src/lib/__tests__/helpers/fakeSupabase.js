// Tiny in-memory stand-in for the supabase-js query builder (only what plannedPush.js uses).
export function fakeSupabase(tables) {
  const db = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]))
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  function builder(name) {
    const filters = []
    let op = 'select'
    let patch = null
    let ord = null
    let lim = Infinity
    const q = {
      select() { return q },
      insert(row) { op = 'insert'; patch = row; return q },
      update(p) { op = 'update'; patch = p; return q },
      delete() { op = 'delete'; return q },
      eq: (c, v) => (filters.push((r) => r[c] === v), q),
      is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), q),
      not: (c, o, v) => (filters.push((r) => (r[c] ?? null) !== v), q),
      in: (c, vs) => (filters.push((r) => vs.includes(r[c])), q),
      gte: (c, v) => (filters.push((r) => r[c] >= v), q),
      lte: (c, v) => (filters.push((r) => r[c] <= v), q),
      or(expr) {
        const parts = expr.split(/,(?=[a-z_]+\.)/).map((p) => {
          const [c, o, ...rest] = p.split('.')
          const v = rest.join('.')
          return (r) => (o === 'not' ? (r[c] ?? null) !== null : o === 'is' ? (r[c] ?? null) === null : o === 'lt' ? (r[c] ?? null) !== null && r[c] < v : false)
        })
        filters.push((r) => parts.some((f) => f(r)))
        return q
      },
      order(c, { ascending = true } = {}) { ord = [c, ascending]; return q },
      limit(n) { lim = n; return q },
      maybeSingle() { q._single = true; return q },
      then(res, rej) { return Promise.resolve(run()).then(res, rej) },
    }
    function run() {
      const rows = db[name]
      if (op === 'insert') {
        const key = (name === 'planned_workout_pushes' || name === 'planned_workout_wahoo_pushes') ? 'workout_id' : 'id'
        if (rows.some((r) => r[key] === patch[key])) return { data: null, error: { message: 'duplicate key' } }
        rows.push({ ...patch })
        return { data: [patch], error: null }
      }
      let hit = rows.filter((r) => filters.every((f) => f(r)))
      if (op === 'update') { hit.forEach((r) => Object.assign(r, patch)); return { data: hit.map((r) => ({ ...r })), error: null } }
      if (op === 'delete') { db[name] = rows.filter((r) => !hit.includes(r)); return { data: null, error: null } }
      if (ord) hit = [...hit].sort((a, b) => cmp(a[ord[0]] ?? '', b[ord[0]] ?? '') * (ord[1] ? 1 : -1))
      hit = hit.slice(0, lim).map((r) => ({ ...r }))
      return { data: q._single ? hit[0] ?? null : hit, error: null }
    }
    return q
  }
  return { from: builder, db }
}

// Records calls; behaviour per method can be overridden.
export function fakeEventsClient(over = {}) {
  const calls = []
  let nextId = 1000
  const client = {
    calls,
    async create(e) { calls.push(['create', e]); if (over.create) return over.create(e); return String(nextId++) },
    async update(id, e) { calls.push(['update', id, e]); if (over.update) return over.update(id, e); return id },
    async get(id) { calls.push(['get', id]); return over.get ? over.get(id) : { id, external_id: over.extId?.(id) } },
    async findByExternalId(x) { calls.push(['find', x]); return over.find ? over.find(x) : null },
    async remove(id) { calls.push(['remove', id]); if (over.remove) return over.remove(id) },
  }
  return client
}

// Records calls to the Wahoo plan client; behaviour per method can be overridden.
export function fakeWahooClient(over = {}) {
  const calls = []
  let n = 100
  const wrap = (name, fallback) => async (...args) => {
    calls.push([name, ...args])
    return over[name] ? over[name](...args) : fallback(...args)
  }
  return {
    calls,
    createPlan: wrap('createPlan', () => String(n++)),
    updatePlan: wrap('updatePlan', (id) => id),
    deletePlan: wrap('deletePlan', () => undefined),
    findPlanByExternalId: wrap('findPlanByExternalId', () => null),
    createWorkout: wrap('createWorkout', () => String(n++)),
    updateWorkout: wrap('updateWorkout', (id) => id),
    deleteWorkout: wrap('deleteWorkout', () => undefined),
  }
}

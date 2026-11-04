// src/lib/exerciseCatalogue.js
//
// Gym exercise catalogue helpers (docs/gym-load.md, docs/data-model.md). Pure search / ranking / duplicate logic plus
// thin Supabase fetchers. Public rows have owner_id NULL; a rider's not-yet-approved suggestions are private rows
// (owner_id = rider) and RLS shows them to the rider, their active coach and admins only.

import { scopeToOwner } from './ownerScope.js'
import { CATALOGUE_COLUMNS } from './gymDetail.js'

export const MOVEMENT_TYPES = Object.freeze(['strength', 'dynamic', 'jump'])
export const MOVEMENT_LABELS = Object.freeze({ strength: 'Strength', dynamic: 'Dynamic / power', jump: 'Jump' })
export const SET_FIELDS = Object.freeze(['reps', 'weight', 'height', 'duration'])
const DEFAULT_FIELDS = ['reps', 'weight']

/** Lowercase, accent-free, single-spaced text for matching ("Knebøj" and "Kneboj" meet; "Légpress" = "legpress"). */
export function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const compact = (t) => normalizeText(t).replace(/ /g, '')

/** Which set inputs to show for an exercise: reps / weight / height / duration. Free text (no catalogue) = reps + weight. */
export function fieldsFor(exercise) {
  const cat = exercise?.catalogue || exercise
  const f = Array.isArray(cat?.set_fields) && cat.set_fields.length ? cat.set_fields : DEFAULT_FIELDS
  return SET_FIELDS.filter((x) => f.includes(x))
}

export const isJump = (exercise) => (exercise?.catalogue || exercise)?.movement_type === 'jump'
export const isUnilateral = (exercise) => Boolean((exercise?.catalogue || exercise)?.unilateral)

/** Higher = better match; 0 = no match. Exact name > name prefix > alias exact/prefix > word start > substring. */
export function matchScore(exercise, query) {
  const q = normalizeText(query)
  if (!q) return 1
  const qc = compact(query)
  const name = normalizeText(exercise.name)
  const names = [name, ...(exercise.aliases || []).map(normalizeText)]
  if (name === q) return 100
  if (name.startsWith(q)) return 90
  if (names.some((n, i) => i > 0 && n === q)) return 85
  if (names.some((n, i) => i > 0 && n.startsWith(q))) return 75
  const words = q.split(' ')
  const hit = (n) => words.every((w) => n.split(' ').some((x) => x.startsWith(w)) || n.includes(w))
  if (names.some(hit)) return 60
  if (qc.length >= 3 && names.some((n) => n.replace(/ /g, '').includes(qc))) return 40
  return 0
}

/**
 * Recent / frequent first usage ranking from the rider's own history rows ({ catalogue_id|null, name, created_at }).
 * @returns {Map<string, { count: number, last: number }>} keyed by catalogue id
 */
export function usageByCatalogue(rows) {
  const map = new Map()
  for (const r of rows || []) {
    if (!r?.catalogue_id) continue
    const t = r.created_at ? Date.parse(r.created_at) || 0 : 0
    const cur = map.get(r.catalogue_id) || { count: 0, last: 0 }
    cur.count++
    cur.last = Math.max(cur.last, t)
    map.set(r.catalogue_id, cur)
  }
  return map
}

/**
 * Search the catalogue. Empty query: used exercises first (most recent, then most frequent), then A-Z by category.
 * With a query: best match first, ties by usage then name.
 */
export function searchExercises(catalogue, query = '', { usage = new Map(), limit = 200 } = {}) {
  const scored = []
  for (const ex of catalogue || []) {
    const score = matchScore(ex, query)
    if (score > 0) scored.push({ ex, score, u: usage.get(ex.id) || { count: 0, last: 0 } })
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    b.u.last - a.u.last ||
    b.u.count - a.u.count ||
    String(a.ex.name).localeCompare(String(b.ex.name)))
  return scored.slice(0, limit).map((s) => s.ex)
}

/** Recently used exercises (most recent first), for the picker's top section. */
export function recentExercises(catalogue, usage, limit = 8) {
  return (catalogue || [])
    .filter((e) => usage.has(e.id))
    .sort((a, b) => usage.get(b.id).last - usage.get(a.id).last || usage.get(b.id).count - usage.get(a.id).count)
    .slice(0, limit)
}

/** Groups by category in first-seen order, for the picker sections. */
export function groupByCategory(list) {
  const groups = new Map()
  for (const e of list || []) {
    const key = e.category || 'Other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(e)
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }))
}

/**
 * Duplicate detection before suggesting: a name or alias that already exists (also ignoring spaces, hyphens, accents
 * and a trailing plural "s"). Returns the existing exercise or null.
 */
export function findExistingExercise(catalogue, name, aliases = []) {
  const wanted = [name, ...(aliases || [])].map(normalizeText).filter(Boolean)
  const variants = (t) => {
    const c = t.replace(/ /g, '')
    return new Set([c, c.replace(/s$/, '')])
  }
  for (const ex of catalogue || []) {
    const have = [ex.name, ...(ex.aliases || [])].map(normalizeText)
    for (const w of wanted) {
      const wv = variants(w)
      if (have.some((h) => [...variants(h)].some((x) => wv.has(x)))) return ex
    }
  }
  return null
}

/** Splits "a, b; c" into a clean unique alias list. */
export function parseAliases(text, max = 20) {
  const seen = new Set()
  const out = []
  for (const a of String(text || '').split(/[,;\n]/)) {
    const t = a.trim().replace(/\s+/g, ' ')
    const k = normalizeText(t)
    if (!t || t.length > 120 || seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out.slice(0, max)
}

/** Public catalogue + the rider's own private exercises (RLS also lets a coach read them, hence the explicit filter). */
export async function fetchCatalogue(client, ownerId) {
  let q = client.from('exercise_catalogue').select(CATALOGUE_COLUMNS).order('name').limit(2000)
  if (ownerId && !/^[\w-]+$/.test(String(ownerId))) throw new Error('fetchCatalogue: invalid owner id')
  q = ownerId ? q.or(`owner_id.is.null,owner_id.eq.${ownerId}`) : q.is('owner_id', null)
  const { data, error } = await q
  return { data: error ? [] : data || [], error: error || null }
}

/** The rider's own exercise usage ({ catalogue_id, name, created_at } rows, newest first) for ranking. */
export async function fetchExerciseUsage(client, ownerId, limit = 1000) {
  const { data } = await scopeToOwner(client.from('gym_exercises').select('catalogue_id, name, created_at'), ownerId)
    .not('catalogue_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  return usageByCatalogue(data || [])
}

/** Creates a private exercise + a pending admin suggestion; returns the existing exercise on a duplicate. */
export async function suggestExercise(client, { name, aliases = [], movementType = 'strength', unilateral = false, category = null }) {
  const { data, error } = await client.rpc('suggest_exercise', {
    p_name: String(name || '').trim(),
    p_aliases: aliases,
    p_movement_type: movementType,
    p_unilateral: Boolean(unilateral),
    p_category: category || null,
  })
  return { data: error ? null : data, error: error || null }
}

/** Display badge for non-public exercises. */
export const privateLabel = (exercise) => (exercise?.owner_id ? 'Private · awaiting approval' : null)

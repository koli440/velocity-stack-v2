// Deterministic applier for the velodrome research pipeline (docs/velodrome-research/PROCESS.md).
// Pure functions only: no network, no database. apply.mjs does the I/O.

export const BATCHES = ['pilot', 'batch-0', 'batch-1', 'batch-2', 'batch-3', 'batch-4', 'batch-5']

export const APPLY_FIELDS = [
  'website_url', 'booking_url', 'pricing_url', 'operator', 'year_built', 'phone', 'email',
  'opening_hours', 'price_range', 'operating_status',
]
const URL_FIELDS = ['website_url', 'booking_url', 'pricing_url']
const OFFICIAL_KINDS = ['operator', 'owner', 'federation']
const URL_RE = /^https?:\/\/[^\s]+$/i
// Mirror of tracks_contact_chk in 20270135000000_velodrome_track_info.sql
const PHONE_RE = /^\+?[0-9][0-9 ()./-]{4,24}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Reviewer names that differ from the researcher's seed_name (the batch-0 review used other spellings).
export const REVIEW_ALIASES = {
  'Brno - Favorit Brno Velodrome': 'Brno - Favorit',
  'Mexico City - Velódromo Olímpico Agustín Melgar': 'Mexico City - Velódromo Agustín Melgar',
  'San Jose - Hellyer Velodrome': 'San Jose - Hellyer Park Velodrome',
  'Aarhus Cykelbane': 'Aarhus Cyklebane',
  'Dalmine - Velodromo': 'Dalmine - Velodromo di Dalmine',
  'Lyon - Vélodrome Georges Préveral': "Lyon - Vélodrome du Parc de la Tête d'Or",
  'Invercargill - Stadium Southland Velodrome': 'Invercargill - SIT Zero Fees Velodrome',
  'Plovdiv - Kolodrum': 'Plovdiv - Kolodruma',
  'Leipzig - Radrennbahn': 'Leipzig - Radrennbahn Leipzig',
  'Beijing - Laoshan': 'Beijing - Laoshan Velodrome',
  Milton: 'Mattamy National Cycling Centre (Milton)',
}

// Researcher seed_name -> the row in public.tracks (name + country_code as stored in the database).
export const DB_IDENTITY = {
  'Novo Mesto - Velodrom Novo Mesto': { name: 'Velodrom Novo Mesto', country_code: 'SLO' },
  Oderlandhalle: { name: 'Frankfurt (Oder) - Oderlandhalle', country_code: 'GER' },
}

// Whole tracks that must not be touched until a human resolves the identity question.
export const HOLD_TRACKS = {
  'Olympic Oval (Calgary)':
    'Seed is wrong: the Olympic Oval 450 m is an indoor running track; the velodrome is the Calgary Velodrome (CBTL, 400 m, Glenmore Athletic Park). Needs a human decision on the seed row; never auto-corrected.',
  'Arima - National Cycling Centre':
    'Identity mismatch: the official SporTT pages describe the National Cycling Velodrome in Couva, while the seed row has Arima coordinates. A human must decide the venue identity and coordinates.',
}

// Reviewer says "verified" but the reason text carries a semantic caveat. Held, never applied.
const CAVEAT_COMMON = [
  'needs[- ]attention', '\\bflag', 'club (session|fee|hours|training)', 'race[- ]entry', 'not general', 'weak',
  'paraphras', 'inferred', 'conflict', 'not confirmed', 'shared',
  'mixes', 'council', 'truncated', 'lower bound', 'bapteme', 'not auto', 'not a track tariff',
  'event pricing', '\\bintro', 'only supports', 'only the park', 'general sports', 'municipal listing', 'not a dedicated',
]
// Confidence wording: moot once medium confidence is allowed (reviewer verdict is still required).
const CAVEAT_CONFIDENCE = ['keep medium', '\\bmedium\\b', 'low/medium']
// Scope wording: acceptable (relaxed rules) only when the stored value itself states the scope.
const CAVEAT_SCOPE = ['caveat', 'not (velodrome|track)[- ]specific', 'venue-wide', 'facility-wide', 'whole-centre', 'centre-wide']
// Price timing ambiguity (e.g. announced increase) is acceptable only for rider-facing per-session prices (relaxed).
const CAVEAT_PRICE_TIMING = ['ambiguous']
const caveatRe = (...groups) => new RegExp(groups.flat().join('|'), 'i')
const CAVEAT_RE = caveatRe(CAVEAT_COMMON, CAVEAT_CONFIDENCE, CAVEAT_SCOPE, CAVEAT_PRICE_TIMING)
// Same pattern order as before the split so strict matching text is unchanged.
const VALUE_SCOPE_RE = /^\s*(whole|entire)\s+(venue|centre|center|facility|complex|building)\b|\b(venue|centre|center|facility|arena|park)-wide\b|\bmay (differ|vary)\b|\bnot (velodrome|track)-specific\b/i
const SESSION_PRICE_RE = /drop-?in|per (session|hour|visit|entry|person|ride)|\/\s*(hr|h|hour|min|session)\b|\b\d+\s*(min|minutes|mins|hour|hours)\b|admission|day (pass|ticket)|single (entry|ticket|session)|adult/i
const NOT_SESSION_PRICE_RE = /club|event|hire|rental|course|lesson|membership|member(s)? only|coach|camp|party|corporate|team|league|structured/i

// Operator/owner pages recognised for source_kind null/other (relaxed rules). Classified by domain (and path where the
// host serves many venues); each entry is a venue's own site or its operator's/owner's official venue page.
// Not allowed: Wikipedia, directories/aggregators, tourism listings, news, clubs that do not operate the venue.
export const OFFICIAL_PAGE_RECLASS = [
  { host: 'better.org.uk', path: /^\/leisure-centre\/lee-valley\//, kind: 'operator', why: 'Better (GLL) operator page for Lee Valley VeloPark' },
  { host: 'thevelodrome.com', kind: 'operator', why: "Valley Preferred Cycling Center's own site" },
  { host: 'hernehillvelodrome.com', kind: 'operator', why: 'Herne Hill Velodrome Trust own site' },
  { host: 'ballerupsuperarena.dk', kind: 'operator', why: "Ballerup Super Arena's own site" },
  { host: 'olimpijskicenter-nm.si', kind: 'operator', why: 'Olimpijski center Novo mesto (operator Zavod Novo mesto) own site' },
  { host: 'jakartainternationalvelodrome.com', kind: 'operator', why: "Jakarta International Velodrome's own site" },
  { host: 'milton.ca', kind: 'owner', why: 'Town of Milton (owner) venue page' },
  { host: 'cbcity.nsw.gov.au', kind: 'owner', why: 'Canterbury-Bankstown Council (owner) venue page' },
  { host: 'stad.gent', kind: 'owner', why: 'City of Ghent (owner) venue page' },
  { host: 'ajsineu.net', kind: 'owner', why: 'Ajuntament de Sineu (owner) page' },
]

export function reclassifyOfficial(url) {
  let u
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.replace(/^www\./, '')
  return OFFICIAL_PAGE_RECLASS.find((r) => r.host === host && (!r.path || r.path.test(u.pathname))) || null
}

// A reason may legitimately explain that the cited page differs from the (reviewer-fixed) one.
const FIX_NOTE_RE = /not on the cited|does not contain|is on https?:\/\/|appears on \/|on \/cycling|on \/abonnements|found live/i

const OPEN_STATEMENT_RE = /\b(open|ouvert|operating|running|resumed)\b|פועל/i

const RESEARCHER_NOTE_RE = /personal|staff|mobile|whatsapp|council|town hall|shared|club event|event price|hire|rental/i

const norm = (s) => String(s).normalize('NFC').trim()

export function resolveTrack(name, researchNames) {
  const n = norm(name)
  if (researchNames.has(n)) return n
  const alias = REVIEW_ALIASES[n]
  if (alias && researchNames.has(alias)) return alias
  throw new Error(`Unresolved track name in review: "${name}"`)
}

export function dbIdentity(seedName, seedValues) {
  return DB_IDENTITY[seedName] || { name: seedName, country_code: seedValues?.country_code ?? null }
}

function priceOk(p) {
  if (!p || typeof p !== 'object') return false
  const nums = ['min', 'max'].map((k) => (p[k] == null ? null : Number(p[k])))
  if (nums.some((n) => n !== null && (!Number.isFinite(n) || n < 0))) return false
  if (nums[0] === null && nums[1] === null) return false
  if (nums[0] !== null && nums[1] !== null && nums[0] > nums[1]) return false
  return /^[A-Z]{3}$/.test(p.currency || '')
}

export const priceText = (p) => {
  const lo = p.min == null ? null : Number(p.min)
  const hi = p.max == null ? null : Number(p.max)
  const range = lo != null && hi != null ? (lo === hi ? `${lo}` : `${lo}-${hi}`) : lo != null ? `from ${lo}` : `up to ${hi}`
  return `${p.currency} ${range}`
}

const valueText = (field, value) => (field === 'price_range' ? priceText(value) : String(value))

// Normalised candidates for one batch: researcher fields, operating_status, not_found and corrections.
export function extractCandidates(batchId, research, review) {
  const names = new Set(research.tracks.map((t) => norm(t.seed_name)))
  const bySeed = new Map(research.tracks.map((t) => [norm(t.seed_name), t]))
  const byKey = new Map()
  const extraByKey = new Map()
  const corrections = []
  for (const r of review.records) {
    const seed = resolveTrack(r.track, names)
    const field = r.kind === 'status' ? 'operating_status' : r.field
    if (r.kind === 'field-extra') extraByKey.set(`${seed}|${field}`, r)
    else if (['field', 'operating_status', 'status'].includes(r.kind)) byKey.set(`${seed}|${field}`, r)
    else if (r.kind === 'correction') {
      corrections.push({ batch: batchId, seed, ...dbIdentity(seed, bySeed.get(seed).seed_values), field, proposed: r.proposed_value, source_url: r.source_url_fix || r.source_url, verdict: r.verdict, reason: r.reason })
    }
  }
  const candidates = []
  const notFound = []
  for (const t of research.tracks) {
    const seed = norm(t.seed_name)
    const base = { batch: batchId, seed, ...dbIdentity(seed, t.seed_values), reviewedDate: review.reviewed_at }
    for (const f of APPLY_FIELDS) {
      const src = f === 'operating_status' ? t.operating_status : t.fields?.[f]
      if (!src || typeof src !== 'object' || src.value == null) continue
      if (f === 'operating_status' && (src.value == null || src.value === 'unknown')) continue
      candidates.push({
        ...base, origin: 'researcher', field: f, value: src.value, source_url: src.source_url,
        evidence: src.evidence, confidence: src.confidence ?? null, source_kind: src.source_kind ?? null,
        note: src.note ?? null, organisational: src.contact_is_organisational === true,
        extraEvidence: Array.isArray(src.extra_evidence) && src.extra_evidence.length > 0,
        review: byKey.get(`${seed}|${f}`) || null, extraReview: extraByKey.get(`${seed}|${f}`) || null,
      })
    }
    for (const nf of t.not_found || []) {
      if (typeof nf === 'string' && APPLY_FIELDS.includes(nf)) notFound.push({ ...base, field: nf })
    }
    if (t.operating_status && (t.operating_status.value == null || t.operating_status.value === 'unknown')) {
      notFound.push({ ...base, field: 'operating_status' })
    }
  }
  const missed = (review.missed_info || []).map((raw) => {
    const seed = resolveTrack(raw.track, names)
    return { batch: batchId, seed, ...dbIdentity(seed, bySeed.get(seed).seed_values), reviewedDate: review.reviewed_at, raw }
  })
  return { candidates, notFound, corrections, missed }
}

function caveatReason(rec, c, relaxed) {
  let reason = rec.reason || ''
  if (rec.source_url_fix) reason = reason.split(/(?<=[.;])\s/).filter((s) => !FIX_NOTE_RE.test(s)).join(' ')
  let re = CAVEAT_RE
  if (relaxed) {
    const scopeStated = c.field === 'opening_hours' && VALUE_SCOPE_RE.test(String(c.value))
    const timingOk = c.field === 'price_range' && /increase/i.test(reason)
    re = caveatRe(CAVEAT_COMMON, scopeStated ? [] : CAVEAT_SCOPE, timingOk ? [] : CAVEAT_PRICE_TIMING)
  }
  const m = reason.match(re)
  return m ? `Reviewer caveat ("${m[0]}"): ${rec.reason}` : null
}

// Decide one researcher candidate: apply | hold (needs attention) | exclude (rejected/unverifiable).
export function decide(c, rules = 'relaxed') {
  const relaxed = rules === 'relaxed'
  const rec = c.review
  if (HOLD_TRACKS[c.seed]) return { decision: 'hold', code: 'identity', reason: HOLD_TRACKS[c.seed] }
  if (!rec) return { decision: 'hold', code: 'not_reviewed', reason: 'No reviewer verdict for this value.' }
  if (rec.verdict === 'rejected') return { decision: 'exclude', code: 'rejected', reason: `Reviewer rejected: ${rec.reason}` }
  if (rec.verdict !== 'verified') return { decision: 'exclude', code: 'unverifiable', reason: `Reviewer verdict ${rec.verdict}: ${rec.reason}` }
  if (rec.value_fix != null || rec.better_value != null || rec.better_source != null) {
    return { decision: 'hold', code: 'reviewer_fix', reason: `Reviewer proposes a different value/source (${JSON.stringify(rec.value_fix ?? rec.better_value ?? rec.better_source)}): ${rec.reason}` }
  }
  const relax = []
  if (relaxed ? !['high', 'medium'].includes(c.confidence) : c.confidence !== 'high') {
    return { decision: 'hold', code: 'confidence', reason: `Researcher confidence is ${c.confidence ?? 'missing'}, not ${relaxed ? 'high/medium' : 'high'}.` }
  }
  if (c.confidence === 'medium') relax.push('medium')
  const url = rec.source_url_fix || c.source_url
  let kind = c.source_kind
  let reclassified
  if (!OFFICIAL_KINDS.includes(kind)) {
    const rc = relaxed && (kind == null || kind === 'other') ? reclassifyOfficial(url) : null
    if (!rc) return { decision: 'hold', code: 'source_kind', reason: `Source kind "${c.source_kind}" is not operator/owner/federation.` }
    reclassified = { from: kind ?? null, to: rc.kind, host: rc.host, why: rc.why }
    kind = rc.kind
    relax.push('source_kind')
  }
  if (!url || !URL_RE.test(url)) return { decision: 'hold', code: 'source_url', reason: 'Missing or invalid source URL.' }
  if (!c.evidence || !String(c.evidence).trim()) return { decision: 'hold', code: 'no_quote', reason: 'No verbatim evidence quote.' }
  const caveat = caveatReason(rec, c, relaxed)
  if (caveat) return { decision: 'hold', code: 'reviewer_caveat', reason: caveat }
  if (c.extraEvidence) return { decision: 'hold', code: 'multi_source', reason: 'Value combines several pages (extra_evidence); one source URL cannot support the whole value.' }
  const f = c.field
  if (f === 'price_range') {
    if (!priceOk(c.value)) return { decision: 'hold', code: 'invalid_value', reason: 'Price range fails the schema constraints.' }
    if (relax.length && !(SESSION_PRICE_RE.test(String(c.evidence)) && !NOT_SESSION_PRICE_RE.test(`${c.evidence} ${c.note ?? ''}`))) {
      return { decision: 'hold', code: 'price_semantics', reason: 'Relaxed rules apply only to rider-facing per-session prices; the evidence does not show one.' }
    }
    if (c.note && /club|event|hire|rental|course|lesson|intro/i.test(c.note) && !/exclud|not includ|without/i.test(c.note)) {
      return { decision: 'hold', code: 'price_semantics', reason: `Researcher note suggests a mixed price basis: ${c.note}` }
    }
  }
  if (URL_FIELDS.includes(f) && !URL_RE.test(String(c.value))) return { decision: 'hold', code: 'invalid_value', reason: 'Not an http(s) URL.' }
  if (f === 'year_built') {
    const y = Number(c.value)
    if (!Number.isInteger(y) || y < 1850 || y > 2100) return { decision: 'hold', code: 'invalid_value', reason: 'year_built outside 1850-2100.' }
  }
  if (f === 'phone' || f === 'email') {
    // Privacy: contacts are never relaxed; they stay high confidence with an organisational confirmation.
    if (c.confidence !== 'high') return { decision: 'hold', code: 'confidence', reason: 'Contacts require high confidence (not relaxed).' }
    if (!c.organisational) return { decision: 'hold', code: 'contact', reason: 'Researcher did not assert an organisational contact.' }
    const confirmed = rec.contact_is_organisational_check === 'confirmed' ||
      /organisational|generic|venue (line|contact|mailbox)|switchboard|reception|mailbox|office|info@/i.test(rec.reason || '')
    if (!confirmed) return { decision: 'hold', code: 'contact', reason: 'Reviewer did not confirm the contact is organisational.' }
    if (c.note && RESEARCHER_NOTE_RE.test(c.note) && !/no person|not personal|excluded/i.test(c.note)) {
      return { decision: 'hold', code: 'contact', reason: `Researcher note flags a possible non-venue contact: ${c.note}` }
    }
    if (f === 'phone' && !PHONE_RE.test(String(c.value))) return { decision: 'hold', code: 'invalid_value', reason: 'Phone does not match the tracks_contact_chk format.' }
    if (f === 'email' && !EMAIL_RE.test(String(c.value))) return { decision: 'hold', code: 'invalid_value', reason: 'Email does not match the tracks_contact_chk format.' }
  }
  if (f === 'operating_status' && !['open', 'closed'].includes(c.value)) return { decision: 'hold', code: 'invalid_value', reason: 'Status is not open/closed.' }
  if (f === 'operating_status' && c.value === 'open' && !(OPEN_STATEMENT_RE.test(String(c.evidence)) && !/other facilities|geschlossen|closed/i.test(String(c.evidence)))) {
    return { decision: 'hold', code: 'status_inferred', reason: 'The quote does not itself state that the track is open/operating (open status would be inferred from hours, tariffs or events).' }
  }
  return {
    decision: 'apply', code: 'apply', reason: 'All auto-apply rules satisfied.', source_url: url, source_kind: kind, relax,
    ...(reclassified ? { reclassified, source_kind_original: c.source_kind ?? null } : {}),
  }
}

// Reviewer-found values count only when complete, official, high confidence and not a correction.
export function decideMissed(m, researcherFields) {
  const raw = m.raw
  const field = raw.field
  const quote = raw.quote ?? raw.evidence ?? null
  const base = {
    batch: m.batch, seed: m.seed, name: m.name, country_code: m.country_code, origin: 'missed', field, value: raw.value,
    source_url: raw.source_url, evidence: quote, confidence: raw.confidence ?? null, source_kind: raw.source_kind ?? null,
    reviewedDate: m.reviewedDate, note: raw.note ?? null, review: null,
  }
  const hold = (code, reason) => ({ ...base, decision: 'hold', code, reason })
  if (HOLD_TRACKS[m.seed]) return hold('identity', HOLD_TRACKS[m.seed])
  if (!APPLY_FIELDS.includes(field)) return hold('not_a_field', `Reviewer finding "${field}" is an observation or correction, not an appliable field.`)
  if (researcherFields.has(`${m.seed}|${field}`)) return hold('replaces_researcher', 'Replaces a value the researcher supplied (treated as a correction).')
  if (!quote || !raw.source_url || raw.value == null || typeof raw.value === 'object' || !URL_RE.test(raw.source_url)) {
    return hold('incomplete', 'Missing verbatim quote, source URL or scalar value.')
  }
  if (raw.confidence !== 'high') return hold('confidence', `Reviewer confidence is ${raw.confidence ?? 'missing'}.`)
  if (!OFFICIAL_KINDS.includes(raw.source_kind)) return hold('source_kind', `Source kind "${raw.source_kind}" is not operator/owner/federation.`)
  if (URL_FIELDS.includes(field) && !URL_RE.test(String(raw.value))) return hold('invalid_value', 'Not an http(s) URL.')
  let value = raw.value
  if (field === 'year_built') {
    value = Number(raw.value)
    if (!Number.isInteger(value) || value < 1850 || value > 2100) return hold('invalid_value', 'year_built invalid.')
  }
  if (['phone', 'email', 'price_range', 'operating_status'].includes(field)) return hold('missed_needs_review', `Reviewer-found ${field} has no second reviewer pass; held.`)
  if (field === 'opening_hours' && /whole|centre-wide|venue-wide/i.test(`${raw.value} ${raw.note || ''}`)) return hold('reviewer_caveat', 'Hours are not specific to the track.')
  return { ...base, value, decision: 'apply', code: 'apply', reason: 'Reviewer-found value with verbatim quote and an official, high-confidence source.' }
}

export function evaluate(inputs, rules = 'relaxed') {
  const items = []
  const notFound = []
  const corrections = []
  const missedAll = []
  const researcherFields = new Set()
  for (const { batch, research, review } of inputs) {
    const x = extractCandidates(batch, research, review)
    for (const c of x.candidates) {
      researcherFields.add(`${c.seed}|${c.field}`)
      items.push({ ...c, ...decide(c, rules), value_text: valueText(c.field, c.value) })
    }
    notFound.push(...x.notFound)
    corrections.push(...x.corrections)
    missedAll.push(...x.missed)
  }
  for (const m of missedAll) {
    const d = decideMissed(m, researcherFields)
    items.push({ ...d, value_text: d.value == null || typeof d.value === 'object' ? null : valueText(d.field, d.value) })
  }
  resolveConflicts(items)
  return { items, notFound, corrections }
}

const rowKey = (it) => `${it.name}|${it.country_code}|${it.field}`

// Same track+field approved twice: equal values collapse into one; different values are a conflict.
// An approved value also conflicts with a differing, reviewer-verified value from another official source.
function resolveConflicts(items) {
  const groups = new Map()
  for (const it of items) {
    if (it.decision !== 'apply') continue
    if (!groups.has(rowKey(it))) groups.set(rowKey(it), [])
    groups.get(rowKey(it)).push(it)
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue
    if (new Set(g.map((i) => i.value_text)).size > 1) {
      for (const it of g) {
        it.decision = 'hold'; it.code = 'conflict'
        it.reason = `Two official sources disagree: ${g.map((i) => `${i.batch}: ${i.value_text}`).join(' vs ')}.`
      }
    } else {
      g.slice(1).forEach((it) => { it.decision = 'duplicate'; it.code = 'duplicate'; it.reason = `Same value already applied from ${g[0].batch}.` })
    }
  }
  const approved = new Map(items.filter((i) => i.decision === 'apply').map((i) => [rowKey(i), i]))
  for (const it of items) {
    if (it.decision !== 'hold' || it.review?.verdict !== 'verified' || !['confidence', 'reviewer_caveat', 'source_kind'].includes(it.code)) continue
    const a = approved.get(rowKey(it))
    if (a && a.value_text !== it.value_text) {
      a.decision = 'hold'; a.code = 'conflict'
      a.reason = `Another verified source disagrees (${it.batch}: ${it.value_text}); not picking one.`
    }
  }
}

// ---- deterministic sampling -------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hashString = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }

export const sampleSize = (n, rate = 0.1, min = 3) => (n === 0 ? 0 : Math.min(n, Math.max(min, Math.ceil(n * rate))))

// ~10% (at least 3) of each batch's applied values, reproducible for a given seed.
export function sampleApplied(applied, seed, { rate = 0.1, min = 3 } = {}) {
  const byBatch = new Map()
  for (const it of applied) {
    if (!byBatch.has(it.batch)) byBatch.set(it.batch, [])
    byBatch.get(it.batch).push(it)
  }
  const out = {}
  for (const [batch, arr] of byBatch) {
    const pool = [...arr].sort((a, b) => `${a.name}|${a.field}`.localeCompare(`${b.name}|${b.field}`))
    const rnd = mulberry32(hashString(`${seed}|${batch}`))
    const picked = []
    for (let i = 0, n = sampleSize(pool.length, rate, min); i < n; i++) picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0])
    out[batch] = picked
  }
  return out
}

// A batch whose sample failure rate exceeds 5% loses every value; otherwise only the failed values are held.
export function applyGate(items, results) {
  const perBatch = {}
  for (const r of results) {
    const b = (perBatch[r.batch] ||= { sampled: 0, failed: 0, failures: [] })
    b.sampled++
    if (r.result === 'fail') { b.failed++; b.failures.push(r) }
  }
  const halted = new Set(Object.entries(perBatch).filter(([, s]) => s.sampled > 0 && s.failed / s.sampled > 0.05).map(([b]) => b))
  const failed = new Set(results.filter((r) => r.result === 'fail').map((r) => `${r.name}|${r.field}`))
  for (const it of items) {
    if (it.decision !== 'apply') continue
    if (halted.has(it.batch)) { it.decision = 'hold'; it.code = 'batch_halted'; it.reason = 'Batch halted: spot-check failure rate above 5%.' }
    else if (failed.has(`${it.name}|${it.field}`)) { it.decision = 'hold'; it.code = 'spot_check_failed'; it.reason = 'Failed the independent spot-check.' }
  }
  return { perBatch, halted: [...halted] }
}

// ---- SQL generation ---------------------------------------------------------------------
const MAP_KIND = (k) => (OFFICIAL_KINDS.includes(k) ? k : 'other')
// Held items that still carry a reviewer-verified source are recorded as needs_attention provenance.
const RECORDED_HOLDS = ['confidence', 'source_kind', 'reviewer_caveat', 'multi_source', 'price_semantics', 'contact', 'conflict', 'spot_check_failed', 'batch_halted']

export function buildEntries(items, notFound) {
  const tracks = new Map()
  const slot = (it) => {
    const k = `${it.name}|${it.country_code}`
    if (!tracks.has(k)) tracks.set(k, { name: it.name, cc: it.country_code, entries: [] })
    return tracks.get(k)
  }
  const verifiedHeld = (it) => it.decision === 'hold' && RECORDED_HOLDS.includes(it.code) &&
    (it.origin === 'missed' ? ['confidence', 'source_kind'].includes(it.code) : it.review?.verdict === 'verified')
  for (const it of items) {
    const apply = it.decision === 'apply'
    if (!apply && !verifiedHeld(it) && !(it.origin === 'missed' && it.code === 'missed_needs_review')) continue
    const url = it.review?.source_url_fix || it.source_url
    if (!url || !URL_RE.test(url) || it.value_text == null) continue
    const e = {
      field: it.field, status: apply ? 'verified' : 'needs_attention', value: it.value_text, url, kind: MAP_KIND(it.source_kind),
      quote: it.evidence ? String(it.evidence) : null, conf: ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : null,
      date: it.reviewedDate,
    }
    if (it.field === 'price_range' && it.value && typeof it.value === 'object') e.json = { min: it.value.min ?? null, max: it.value.max ?? null, currency: it.value.currency }
    slot(it).entries.push(e)
  }
  const seenField = new Set(items.map(rowKey))
  for (const nf of notFound) {
    if (HOLD_TRACKS[nf.seed] || seenField.has(rowKey(nf))) continue
    seenField.add(rowKey(nf))
    slot(nf).entries.push({ field: nf.field, status: 'not_found', date: nf.reviewedDate })
  }
  const rank = { verified: 0, needs_attention: 1, not_found: 2 }
  for (const t of tracks.values()) {
    t.entries.sort((a, b) => rank[a.status] - rank[b.status] || a.field.localeCompare(b.field))
    const seen = new Set()
    t.entries = t.entries.filter((e) => (seen.has(e.field) ? false : (seen.add(e.field), true)))
    t.entries.sort((a, b) => a.field.localeCompare(b.field))
  }
  return [...tracks.values()].filter((t) => t.entries.length).sort((a, b) => `${a.name}|${a.cc}`.localeCompare(`${b.name}|${b.cc}`))
}

export const CHUNK_MAX_TRACKS = 20
export const CHUNK_MAX_BYTES = 30000

// Seed coordinates (docs/velodrome-research/track-coordinates.json, keyed "name|cc") enable the migrations' coordinate fallback match.
export function withCoordinates(tracks, coords) {
  return tracks.map((t) => {
    const c = coords[`${t.name}|${t.cc}`]
    return c ? { name: t.name, cc: t.cc, lat: c[0], lon: c[1], entries: t.entries } : t
  })
}

// Splits tracks (already sorted) into independent chunks: at most maxTracks tracks and maxBytes of JSON each.
export function chunkTracks(tracks, { maxTracks = CHUNK_MAX_TRACKS, maxBytes = CHUNK_MAX_BYTES } = {}) {
  const chunks = []
  let cur = [], size = 0
  for (const t of tracks) {
    const n = JSON.stringify(t, null, 1).length
    if (cur.length && (cur.length >= maxTracks || size + n > maxBytes)) { chunks.push(cur); cur = []; size = 0 }
    cur.push(t); size += n
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

// One small data migration: calls public.apply_velodrome_info() (20270136000000_velodrome_info_apply_helper.sql), which skips and
// logs unmatched tracks and rejected fields. The outer handler guarantees that nothing in here can fail the migration.
export function renderMigration(tracks, header, batch) {
  const json = JSON.stringify(tracks, null, 1)
  if (json.includes('$json$')) throw new Error('Data contains the dollar-quote tag')
  if (!/^[a-z0-9_-]+$/.test(batch || '')) throw new Error('Invalid batch id')
  return `${header}
DO $migration$
BEGIN
    PERFORM public.apply_velodrome_info('${batch}', $json$${json}$json$::jsonb);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'velodrome info ${batch}: skipped (%): %', SQLSTATE, SQLERRM;
    BEGIN
        PERFORM public.velodrome_info_log('${batch}', NULL, NULL, NULL, 'batch_error', SQLSTATE || ': ' || SQLERRM);
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'velodrome info ${batch}: could not write apply log';
    END;
END
$migration$;
`
}

// Coach card (public page /c/<slug>, directory /coaches, editor /settings/coach-card).
// Data goes through SECURITY DEFINER RPCs (supabase/migrations/20270152000000_coach_cards.sql); the tables are not
// client accessible. See docs/coaching.md.
import { SITE_URL } from './seo.js'

export const COACH_CARD_PATH = '/c'
export const COACH_DIRECTORY_PATH = '/coaches'
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/
export const HEADLINE_MAX = 80
export const BIO_MAX = 1500
export const LOCATION_MAX = 60
export const PACKAGE_MAX = 6
export const PACKAGE_TITLE_MAX = 60
export const PACKAGE_DESC_MAX = 300
export const DISCIPLINE_OPTIONS = Object.freeze(['track', 'road', 'gravel', 'mtb', 'time trial', 'triathlon', 'endurance', 'sprint'])
export const COACH_MEDIA_BUCKET = 'coach-media'
export const MAX_COACH_MEDIA_BYTES = 5 * 1024 * 1024
export const ALLOWED_COACH_MEDIA_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp'])
export const MEDIA_KINDS = Object.freeze(['logo', 'banner'])
const MEDIA_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
export const CURRENCIES = Object.freeze(['eur', 'gbp', 'usd'])
export const INTERVALS = Object.freeze({ month: 'month', quarter: 'quarter', year: 'year' })
export const PACKAGE_KINDS = Object.freeze({ subscription: 'Subscription', one_time: 'One-time', free: 'Free' })

// Fixed palette (contrast-checked classes, no arbitrary CSS). `hex` is used by the OG image.
export const ACCENTS = Object.freeze({
  orange: { hex: '#f97316', bar: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', ring: 'border-orange-500' },
  emerald: { hex: '#10b981', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', ring: 'border-emerald-500' },
  sky: { hex: '#0ea5e9', bar: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', ring: 'border-sky-500' },
  violet: { hex: '#8b5cf6', bar: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', ring: 'border-violet-500' },
  rose: { hex: '#f43f5e', bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', ring: 'border-rose-500' },
  amber: { hex: '#f59e0b', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', ring: 'border-amber-500' },
  teal: { hex: '#14b8a6', bar: 'bg-teal-500', text: 'text-teal-600 dark:text-teal-400', ring: 'border-teal-500' },
  slate: { hex: '#64748b', bar: 'bg-slate-500', text: 'text-slate-600 dark:text-slate-300', ring: 'border-slate-500' },
})
export const accentOf = (name) => ACCENTS[name] || ACCENTS.orange

export const cardPath = (slug) => `${COACH_CARD_PATH}/${slug}`
export const cardUrl = (slug, origin = SITE_URL) => `${origin}${cardPath(slug)}`
export const isValidSlug = (slug) => typeof slug === 'string' && SLUG_RE.test(slug)

/** Suggests a link name from a display name ("Ann O'Neil" -> "ann-oneil"). */
export function suggestSlug(name) {
  const s = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '')
  return s.length >= 3 ? s : ''
}

/** "EUR 80 / month" style price line; null when the package has no price. */
export function priceLabel(pkg) {
  if (!pkg || pkg.kind === 'free') return 'Free'
  if (pkg.amount_cents == null) return null
  const amount = (pkg.amount_cents / 100).toLocaleString('en', { minimumFractionDigits: pkg.amount_cents % 100 ? 2 : 0, maximumFractionDigits: 2 })
  const base = `${String(pkg.currency || 'eur').toUpperCase()} ${amount}`
  return pkg.kind === 'subscription' && pkg.interval ? `${base} / ${pkg.interval}` : base
}

/** Client-side mirror of the SQL validation; returns the first problem or null. */
export function validateCard(card) {
  const slug = String(card?.slug || '').trim().toLowerCase()
  if (!SLUG_RE.test(slug)) return 'The link name needs 3-30 letters, numbers or dashes.'
  if (String(card?.headline || '').trim().length > HEADLINE_MAX) return `The headline can have at most ${HEADLINE_MAX} characters.`
  if (String(card?.bio || '').trim().length > BIO_MAX) return `The bio can have at most ${BIO_MAX} characters.`
  if (String(card?.location || '').trim().length > LOCATION_MAX) return `The location can have at most ${LOCATION_MAX} characters.`
  if (card?.accent && !ACCENTS[card.accent]) return 'Pick one of the colours.'
  const pkgs = card?.packages || []
  if (pkgs.length > PACKAGE_MAX) return `At most ${PACKAGE_MAX} packages.`
  for (const p of pkgs) {
    if (!String(p.title || '').trim()) return 'Every package needs a title.'
    if (String(p.title).trim().length > PACKAGE_TITLE_MAX) return `Package titles can have at most ${PACKAGE_TITLE_MAX} characters.`
    if (String(p.description || '').length > PACKAGE_DESC_MAX) return `Package descriptions can have at most ${PACKAGE_DESC_MAX} characters.`
    if (!PACKAGE_KINDS[p.kind]) return 'Unknown package type.'
    if (p.kind === 'subscription' && !INTERVALS[p.interval]) return 'Choose how often a subscription renews.'
    if (p.kind !== 'free' && p.amount_cents != null && !(Number.isInteger(p.amount_cents) && p.amount_cents >= 0 && p.amount_cents <= 1000000)) {
      return 'Enter a valid price.'
    }
  }
  if (card?.max_athletes != null && card.max_athletes !== '' && !(Number.isInteger(Number(card.max_athletes)) && card.max_athletes >= 1 && card.max_athletes <= 500)) {
    return 'The athlete limit must be between 1 and 500.'
  }
  return null
}

/** Comma separated text -> trimmed unique list (max 8). */
export function parseList(text) {
  const seen = new Set()
  for (const part of String(text || '').split(',')) {
    const v = part.trim()
    if (v) seen.add(v.slice(0, 30))
  }
  return [...seen].slice(0, 8)
}

export function coachCardErrorMessage(error) {
  const msg = String(error?.message || '')
  if (/not enabled/i.test(msg)) return 'The coach module is not available for your account yet.'
  if (/already taken/i.test(msg)) return 'That link name is already taken.'
  if (/Invalid or reserved/i.test(msg)) return 'That link name is not allowed. Use 3-30 letters, numbers or dashes.'
  if (/Invalid (logo|banner) image/i.test(msg)) return 'That image is not valid. Upload it again.'
  if (/Too many/i.test(msg)) return msg
  if (/At most 6/i.test(msg)) return 'At most 6 packages.'
  if (/Create your coach card/i.test(msg)) return 'Save your coach card first.'
  return 'Something went wrong. Please try again.'
}

/** Meta description for the public page. */
export function cardDescription(card) {
  const bits = [card.headline, card.location, (card.disciplines || []).join(', ')].filter(Boolean)
  return bits.join(' · ') || `${card.name} is a cycling coach on VelocityStack.`
}

/** Entries for the directory search request. */
export function directoryQuery({ q = '', discipline = '' } = {}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (discipline) params.set('discipline', discipline)
  const s = params.toString()
  return s ? `${COACH_DIRECTORY_PATH}?${s}` : COACH_DIRECTORY_PATH
}

/** @returns {string|null} an error message, or null when the file can be uploaded as card media */
export function validateCoachMediaFile(file) {
  if (!file) return 'No file selected'
  if (!ALLOWED_COACH_MEDIA_TYPES.includes(file.type)) return 'Only JPG, PNG or WebP images are allowed'
  if (file.size > MAX_COACH_MEDIA_BYTES) return 'Image is larger than 5 MB'
  return null
}

// A new object name per upload keeps caches from serving the old image; the database only accepts this shape.
export function buildCoachMediaPath({ userId, kind, mimeType, version = Date.now() }) {
  return `${userId}/${kind}-${version}.${MEDIA_EXT[mimeType] || 'jpg'}`
}

/** Same rule as the database: only the coach's own coach-media objects of the matching kind. */
export function isCoachMediaUrl(url, { userId, kind }) {
  if (!url || !userId || !MEDIA_KINDS.includes(kind)) return false
  return new RegExp(`^https://[^/?#@]+/storage/v1/object/public/${COACH_MEDIA_BUCKET}/${userId}/${kind}-[0-9]+\\.(jpg|png|webp)$`).test(String(url))
}

/** URL of a card image that is safe to render: https on the Supabase host, inside the coach-media bucket. */
export function safeCoachMediaUrl(url, supabaseUrl = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_URL : '') {
  try {
    const base = new URL(String(supabaseUrl || ''))
    const u = new URL(String(url || ''))
    if (u.protocol !== 'https:' || u.host !== base.host || u.username || u.password) return null
    return u.pathname.startsWith(`/storage/v1/object/public/${COACH_MEDIA_BUCKET}/`) ? u.toString() : null
  } catch {
    return null
  }
}

// ---- Data access ---------------------------------------------------------------------------

export async function fetchMyCoachCard(client) {
  const { data, error } = await client.rpc('my_coach_card')
  return { card: error ? null : data || null, error }
}

export async function saveCoachCard(client, card) {
  const { data, error } = await client.rpc('save_coach_card', {
    p: {
      slug: String(card.slug || '').trim().toLowerCase(),
      headline: card.headline || '',
      bio: card.bio || '',
      accent: card.accent || 'orange',
      disciplines: card.disciplines || [],
      languages: card.languages || [],
      location: card.location || '',
      accepting_athletes: card.accepting_athletes !== false,
      ...(card.logo_url !== undefined ? { logo_url: card.logo_url || '' } : {}),
      ...(card.banner_url !== undefined ? { banner_url: card.banner_url || '' } : {}),
      max_athletes: card.max_athletes === '' || card.max_athletes == null ? null : Number(card.max_athletes),
      packages: (card.packages || []).map((p) => ({
        id: p.id || null,
        title: p.title,
        description: p.description || '',
        kind: p.kind,
        interval: p.kind === 'subscription' ? p.interval : null,
        amount_cents: p.kind === 'free' || p.amount_cents === '' ? null : p.amount_cents ?? null,
        currency: p.currency || 'eur',
        is_active: p.is_active !== false,
      })),
    },
  })
  return { slug: data || null, error }
}

/** Uploads a logo/banner file and returns its public URL (not yet saved on the card). */
export async function uploadCoachMedia(client, { userId, kind, file }) {
  const invalid = validateCoachMediaFile(file)
  if (invalid) return { url: null, path: null, error: new Error(invalid) }
  if (!userId || !MEDIA_KINDS.includes(kind)) return { url: null, path: null, error: new Error('Not signed in') }
  const path = buildCoachMediaPath({ userId, kind, mimeType: file.type })
  const bucket = client.storage.from(COACH_MEDIA_BUCKET)
  const { error } = await bucket.upload(path, file, { contentType: file.type, cacheControl: '3600' })
  if (error) return { url: null, path: null, error }
  return { url: bucket.getPublicUrl(path).data?.publicUrl || null, path, error: null }
}

/** Best effort clean-up: deletes the coach's stored files of one kind, except `keepPath`. */
export async function removeCoachMediaObjects(client, { userId, kind, keepPath = null }) {
  if (!userId || !MEDIA_KINDS.includes(kind)) return
  const bucket = client.storage.from(COACH_MEDIA_BUCKET)
  const { data } = await bucket.list(userId)
  const stale = (data || []).filter((o) => o.name.startsWith(`${kind}-`)).map((o) => `${userId}/${o.name}`).filter((p) => p !== keepPath)
  if (stale.length) await bucket.remove(stale)
}

export async function setCoachCardVisibility(client, isPublic, isListed) {
  const { error } = await client.rpc('set_coach_card_visibility', { p_public: !!isPublic, p_listed: !!isListed })
  return { error }
}

export async function reportCoachCard(client, slug, reason) {
  const { error } = await client.rpc('report_coach_card', { p_slug: slug, p_reason: reason })
  return { error }
}

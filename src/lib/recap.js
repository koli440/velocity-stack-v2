// Season recap ("Wrapped") pure helpers: year/slug validation, story cards from the season_recap() JSON, banner window,
// share URL/text. The data comes from the SQL functions in 20270149000000_season_recap.sql (see docs/season-recap.md).
import { SITE_URL } from './seo.js'

export const MIN_RECAP_YEAR = 2000
export const SLUG_RE = /^[0-9a-f]{20}$/
export const SHARE_PATH = '/recap/s'
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const isRecapSharePath = (pathname) => String(pathname || '').startsWith(`${SHARE_PATH}/`)

/** Route param -> year, or null when it is not a plausible season year. */
export function parseRecapYear(value, now = new Date()) {
  if (!/^\d{4}$/.test(String(value ?? ''))) return null
  const y = Number(value)
  return y >= MIN_RECAP_YEAR && y <= now.getUTCFullYear() ? y : null
}

export const isValidSlug = (slug) => typeof slug === 'string' && SLUG_RE.test(slug)
export const recapPath = (year) => `/recap/${year}`
export const recapSharePath = (slug) => `${SHARE_PATH}/${slug}`
export const recapShareUrl = (slug, origin = SITE_URL) => `${origin}${recapSharePath(slug)}`

/** Year the dashboard banner promotes: Oct-Dec the current season, Jan-Feb the one that just ended, else none. */
export function bannerYear(now = new Date()) {
  const m = now.getUTCMonth()
  if (m >= 9) return now.getUTCFullYear()
  if (m <= 1) return now.getUTCFullYear() - 1
  return null
}
export const bannerDismissKey = (year) => `vs.recapBanner.${year}`

const nf = (n, digits = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
export const fmtKm = (km) => `${nf(km, km >= 100 ? 0 : 1)} km`
export const fmtHours = (h) => `${nf(h, h >= 100 ? 0 : 1)} h`
export const monthName = (m) => MONTH_NAMES[m - 1] || ''

export function fmtPbTime(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return ''
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return m > 0 ? `${m}:${rest.toFixed(3).padStart(6, '0')}` : `${rest.toFixed(3)} s`
}

const has = (n) => typeof n === 'number' && n > 0

/**
 * Story cards for a recap. Cards whose data is missing (no distance, power, elevation, velodrome, ...) are left out,
 * so a rider without GPS or a power meter still gets a complete, honest story.
 * @returns {{id:string, title:string, big?:string, lines:string[], bars?:{label:string, value:number}[]}[]}
 */
export function buildRecapCards(recap, { name } = {}) {
  if (!recap) return []
  const year = recap.year
  const cards = [{ id: 'intro', title: `${name ? `${name}'s` : 'Your'} ${year} season`, big: String(year), lines: ['Velocity Stack season recap'] }]

  if (!has(recap.ride_count)) {
    cards.push({ id: 'empty', title: 'No rides yet', lines: [`No rides recorded in ${year}.`] })
    return cards
  }

  const totals = []
  if (has(recap.distance_km)) totals.push(`${fmtKm(recap.distance_km)} ridden`)
  if (has(recap.hours)) totals.push(`${fmtHours(recap.hours)} in the saddle`)
  if (has(recap.elevation_m)) totals.push(`${nf(recap.elevation_m)} m climbed`)
  totals.push(`${nf(recap.active_days)} active ${recap.active_days === 1 ? 'day' : 'days'}`)
  cards.push({ id: 'totals', title: 'Your season in numbers', big: `${nf(recap.ride_count)} ${recap.ride_count === 1 ? 'ride' : 'rides'}`, lines: totals })

  const lr = recap.longest_ride
  if (lr && has(lr.distance_km)) {
    cards.push({ id: 'longest', title: 'Longest ride', big: fmtKm(lr.distance_km), lines: [has(lr.hours) ? `${fmtHours(lr.hours)} on ${lr.date}` : lr.date] })
  }

  const bp = recap.best_power
  if (bp && (has(bp.max_power_w) || has(bp.best_avg_power_w) || has(bp.best_np_w))) {
    const lines = []
    if (has(bp.best_avg_power_w)) lines.push(`Best average power ${nf(bp.best_avg_power_w)} W`)
    if (has(bp.best_np_w)) lines.push(`Best normalized power ${nf(bp.best_np_w)} W`)
    cards.push({ id: 'power', title: 'Peak power', gauge: bp.max_power_w > 0 ? Math.min(1, (bp.best_avg_power_w || bp.best_np_w || 0) / bp.max_power_w) : undefined, big: has(bp.max_power_w) ? `${nf(bp.max_power_w)} W` : `${nf(bp.best_avg_power_w || bp.best_np_w)} W`, lines })
  }

  const pb = recap.personal_bests
  if (pb && has(pb.count)) {
    const lines = (pb.items || []).slice(0, 3).map((i) => [i.discipline, i.event, fmtPbTime(i.time_seconds)].filter(Boolean).join(' · '))
    cards.push({ id: 'pbs', title: 'Personal bests', trophies: Math.min(pb.count, 5), big: `${nf(pb.count)} new ${pb.count === 1 ? 'PB' : 'PBs'}`, lines })
  }

  if (recap.longest_streak && recap.longest_streak.days >= 2) {
    cards.push({ id: 'streak', title: 'Longest streak', big: `${recap.longest_streak.days} days`, streak: Math.min(recap.longest_streak.days, 31), lines: [`Riding every day, ${recap.longest_streak.start} to ${recap.longest_streak.end}`] })
  }

  const bm = recap.busiest_month
  if (bm) {
    const lines = [`${nf(bm.rides)} ${bm.rides === 1 ? 'ride' : 'rides'}`]
    if (has(bm.distance_km)) lines.unshift(fmtKm(bm.distance_km))
    const bars = monthlyBars(recap)
    cards.push({ id: 'month', title: 'Busiest month', big: monthName(bm.month), lines, bars, peak: bm.month })
  }

  const fv = recap.favorite_velodrome
  if (fv?.name) {
    cards.push({ id: 'velodrome', title: 'Favorite velodrome', big: fv.name, lines: [[fv.location, `${nf(fv.rides)} ${fv.rides === 1 ? 'ride' : 'rides'} there`].filter(Boolean).join(' · ')] })
  }
  return cards
}

/** Short stats used by the PNG and the OG image: up to three headline numbers. */
export function headlineStats(recap) {
  if (!recap || !has(recap.ride_count)) return []
  const out = []
  if (has(recap.distance_km)) out.push({ label: 'distance', value: fmtKm(recap.distance_km) })
  if (has(recap.hours)) out.push({ label: 'time', value: fmtHours(recap.hours) })
  if (has(recap.elevation_m)) out.push({ label: 'climbing', value: `${nf(recap.elevation_m)} m` })
  out.push({ label: recap.ride_count === 1 ? 'ride' : 'rides', value: nf(recap.ride_count) })
  return out.slice(0, 4)
}

export const AVATAR_PATH_PREFIX = '/storage/v1/object/public/avatars/'

/**
 * Avatar URLs come from a client-writable column, so only https URLs on our own Supabase storage host and the public
 * `avatars` bucket path are accepted (also stops the OG renderer from fetching arbitrary hosts).
 */
export function safeAvatarUrl(url, supabaseUrl = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_URL : '') {
  try {
    const base = new URL(String(supabaseUrl || ''))
    const u = new URL(String(url || ''))
    if (u.protocol !== 'https:' || u.host !== base.host || u.username || u.password) return null
    return u.pathname.startsWith(AVATAR_PATH_PREFIX) ? u.toString() : null
  } catch {
    return null
  }
}

/** 12 monthly bars (distance when the season has any, else ride counts) with heights 0..1 and the peak flagged. */
export function monthlyBars(recap) {
  if (!recap || !Array.isArray(recap.months) || !recap.months.length) return []
  const useKm = has(recap.distance_km)
  const vals = recap.months.map((m) => Number(useKm ? m.distance_km : m.rides) || 0)
  const max = Math.max(...vals, 0)
  return recap.months.map((m, i) => ({
    month: m.month,
    label: monthName(m.month).slice(0, 1),
    value: vals[i],
    height: max > 0 ? vals[i] / max : 0,
    peak: max > 0 && vals[i] === max,
  }))
}

/** Visual accent (Tailwind gradient + hex pair for canvas/OG) per story card. */
export const CARD_THEMES = {
  intro: { gradient: 'from-emerald-700 via-slate-900 to-slate-950', from: '#047857', to: '#020617', icon: '🚴' },
  totals: { gradient: 'from-sky-700 via-slate-900 to-slate-950', from: '#0369a1', to: '#020617', icon: '🛣️' },
  longest: { gradient: 'from-indigo-700 via-slate-900 to-slate-950', from: '#4338ca', to: '#020617', icon: '📏' },
  power: { gradient: 'from-amber-600 via-rose-900 to-slate-950', from: '#d97706', to: '#020617', icon: '⚡' },
  pbs: { gradient: 'from-yellow-600 via-amber-900 to-slate-950', from: '#ca8a04', to: '#020617', icon: '🏆' },
  streak: { gradient: 'from-orange-600 via-red-900 to-slate-950', from: '#ea580c', to: '#020617', icon: '🔥' },
  month: { gradient: 'from-fuchsia-700 via-purple-900 to-slate-950', from: '#a21caf', to: '#020617', icon: '📅' },
  velodrome: { gradient: 'from-teal-700 via-slate-900 to-slate-950', from: '#0f766e', to: '#020617', icon: '🏟️' },
  empty: { gradient: 'from-slate-800 to-slate-950', from: '#1e293b', to: '#020617', icon: '🚴' },
}
export const cardTheme = (id) => CARD_THEMES[id] || CARD_THEMES.empty

export const recapShareText = (year, name) => `${name ? `${name}'s` : 'My'} ${year} cycling season recap on Velocity Stack`

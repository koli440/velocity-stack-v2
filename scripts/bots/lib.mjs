import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { PERSONAS, personaEmail } from './personas.mjs'
import { generateRide } from './generate-ride.mjs'
import { encodeFit } from './fit.mjs'
import { buildActivityInsert } from '../../src/lib/activityRecord.js'
import { refreshUserBadges } from '../../src/lib/feedSync.js'

export function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export const today = () => new Date().toISOString().slice(0, 10)

export function dateRange(from, to) {
  const out = []
  for (let d = Date.parse(`${from}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`); d += 86400000) {
    out.push(new Date(d).toISOString().slice(0, 10))
  }
  return out
}

export function addDays(dateStr, n) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}

// Creates (or finds) the auth user + flagged profile for every persona. Idempotent.
export async function ensureBots(sb, personas = PERSONAS) {
  const bots = []
  for (const p of personas) {
    const email = personaEmail(p)
    let id = null
    for (let page = 1; !id && page <= 20; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw error
      id = data.users.find((u) => u.email === email)?.id ?? null
      if (data.users.length < 200) break
    }
    if (!id) {
      const { data, error } = await sb.auth.admin.createUser({
        email,
        password: crypto.randomBytes(24).toString('base64url'),
        email_confirm: true,
      })
      if (error) throw error
      id = data.user.id
    }

    const { data: track } = await sb.from('tracks').select('id, length_m, latitude, longitude, elevation_m').eq('name', p.track).maybeSingle()
    const { error } = await sb.from('profiles').upsert({
      id,
      first_name: p.first_name,
      last_name: p.last_name,
      nickname: p.nickname,
      home_track_id: track?.id ?? null,
      default_chainring: p.gear.chainring,
      default_cog: p.gear.cog,
      ftp_w: p.ftp,
      is_bot: true,
      bot_persona: p.key,
      require_follow_approval: false,
    })
    if (error) throw error
    bots.push({ persona: p, id, track })
  }
  return bots
}

async function analyze(appUrl, fitBuffer, gear) {
  const form = new FormData()
  form.append('file', new Blob([fitBuffer]), 'bot-ride.fit')
  form.append('chainring', String(gear.chainring))
  form.append('cog', String(gear.cog))
  form.append('is_fixed_gear', 'true')
  const res = await fetch(new URL('/api/analyze', appUrl), { method: 'POST', body: form })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) throw new Error(`/api/analyze failed (${res.status}): ${json?.error || 'no body'}`)
  return json
}

// Best 200 m window (flying 200) of the ride, from cumulative distance.
export function best200m(records) {
  let best = null
  let j = 0
  for (let i = 0; i < records.length; i++) {
    while (j < records.length && records[j].distance - records[i].distance < 200) j++
    if (j >= records.length) break
    const sec = j - i
    if (!best || sec < best.sec) best = { sec, i, j }
  }
  return best
}

/** Generates, analyzes (real pipeline) and stores one bot ride. Returns 'rested' | 'exists' | 'created'. */
export async function runBotDay(sb, bot, dateStr, appUrl) {
  const { persona, id, track } = bot
  const ride = generateRide(persona, dateStr, {
    trackLengthM: Number(track?.length_m) || 250,
    lat: Number(track?.latitude) || 43.5,
    lng: Number(track?.longitude) || -79.9,
    altitude: Number(track?.elevation_m) || 200,
  })
  if (!ride) return 'rested'

  const fit = encodeFit(ride)
  const sha = crypto.createHash('sha256').update(fit).digest('hex')
  const { data: dup } = await sb.from('activities').select('id').eq('user_id', id).eq('file_sha256', sha).limit(1)
  if (dup?.length) return 'exists'

  const parsed = await analyze(appUrl, fit, ride.gear)
  const row = {
    ...buildActivityInsert(parsed.summary, {
      title: ride.title,
      userId: id,
      trackId: track?.id ?? null,
      chainring: ride.gear.chainring,
      cog: ride.gear.cog,
      timeSeries: parsed.time_series,
      curvesData: parsed.curves,
      fileSha256: sha,
      ftpWatts: persona.ftp,
      fallbackActivityDate: ride.startTime.toISOString(),
    }),
    visibility: 'public',
  }
  const { data: act, error } = await sb.from('activities').insert(row).select('id').single()
  if (error) throw error

  const curveRows = Object.entries(parsed.curves || {}).map(([curve_type, data]) => ({ activity_id: act.id, curve_type, data }))
  if (curveRows.length) await sb.from('activity_curves').insert(curveRows)

  if (ride.type === 'flying') await maybeRecordPb(sb, bot, ride, dateStr)
  await refreshUserBadges(sb, id)
  return 'created'
}

async function maybeRecordPb(sb, bot, ride, dateStr) {
  const win = best200m(ride.records)
  if (!win) return
  const seconds = Math.round(win.sec * 1000) / 1000
  const { data: prev } = await sb
    .from('personal_bests')
    .select('time_seconds')
    .eq('user_id', bot.id)
    .eq('discipline', '200m Flying')
    .order('time_seconds', { ascending: true })
    .limit(1)
  if (prev?.length && Number(prev[0].time_seconds) <= seconds) return
  const { error } = await sb.from('personal_bests').insert({
    user_id: bot.id,
    track_id: bot.track?.id ?? null,
    track_name: bot.persona.track,
    discipline: '200m Flying',
    discipline_distance_m: 200,
    achieved_date: dateStr,
    time_seconds: seconds,
    avg_speed_kmh: Math.round((200 / seconds) * 3.6 * 100) / 100,
    chainring: ride.gear.chainring,
    cog: ride.gear.cog,
    split_mode: 'laps',
    lap_times: [],
    notes: 'Synthetic bot ride',
  })
  if (error) console.warn(`PB insert failed for ${bot.persona.key}: ${error.message}`)
}

// Bots follow back real riders who follow them (skips blocks).
export async function followBack(sb, bots) {
  const botIds = bots.map((b) => b.id)
  const { data: incoming, error } = await sb.from('follows').select('follower_id, followee_id').in('followee_id', botIds)
  if (error) throw error
  const real = (incoming || []).filter((f) => !botIds.includes(f.follower_id))
  if (!real.length) return 0
  const { data: blocks } = await sb.from('blocks').select('blocker_id, blocked_id').or(`blocker_id.in.(${botIds.join(',')}),blocked_id.in.(${botIds.join(',')})`)
  const blocked = new Set((blocks || []).flatMap((b) => [`${b.blocker_id}|${b.blocked_id}`, `${b.blocked_id}|${b.blocker_id}`]))
  const rows = real
    .filter((f) => !blocked.has(`${f.followee_id}|${f.follower_id}`))
    .map((f) => ({ follower_id: f.followee_id, followee_id: f.follower_id }))
  if (!rows.length) return 0
  const { error: upErr } = await sb.from('follows').upsert(rows, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true })
  if (upErr) throw upErr
  return rows.length
}

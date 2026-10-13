// Live end-to-end check of follow + bot schema. Creates a throwaway user, then removes it.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { adminClient, ensureBots, followBack } from './lib.mjs'

const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
if (!anon) throw new Error('SUPABASE_ANON_KEY is required')

const sb = adminClient()
const checks = []
const check = (name, ok, extra = '') => {
  checks.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${ok ? '' : extra}`)
}

const bots = await ensureBots(sb)
const bot = bots[0]
const email = `follow-check-${crypto.randomUUID()}@bots.velocity-stack.invalid`
const password = crypto.randomBytes(18).toString('base64url')
const { data: created, error: cErr } = await sb.auth.admin.createUser({ email, password, email_confirm: true })
if (cErr) throw cErr
const uid = created.user.id
try {
  await sb.from('profiles').upsert({ id: uid, first_name: 'Follow', last_name: 'Check' })
  const user = createClient(url, anon, { auth: { persistSession: false } })
  const { error: sErr } = await user.auth.signInWithPassword({ email, password })
  check('sign in', !sErr, sErr?.message)

  const { data: pp, error: ppErr } = await user.from('public_profiles').select('id, username, is_bot').eq('id', bot.id).single()
  check('public_profiles exposes is_bot', !ppErr && pp?.is_bot === true, ppErr?.message)

  const { error: fErr } = await user.from('follows').insert({ follower_id: uid, followee_id: bot.id })
  check('user can follow bot (RLS)', !fErr, fErr?.message)

  const { error: flagErr } = await user.from('profiles').update({ is_bot: true }).eq('id', uid)
  const { data: self } = await sb.from('profiles').select('is_bot').eq('id', uid).single()
  check('user cannot self-flag as bot', self?.is_bot === false, flagErr?.message)

  await followBack(sb, bots)
  const { data: back } = await sb.from('follows').select('follower_id').eq('follower_id', bot.id).eq('followee_id', uid)
  check('bot followed back', back?.length === 1)

  const { data: feed, error: feedErr } = await user.from('shared_activities').select('id').eq('user_id', bot.id).limit(1)
  check('shared_activities readable', !feedErr, feedErr?.message)
  console.log(`bot has ${feed?.length ? 'at least one' : 'no'} shared activity yet`)
} finally {
  await sb.auth.admin.deleteUser(uid)
}
process.exit(checks.every(Boolean) ? 0 : 1)

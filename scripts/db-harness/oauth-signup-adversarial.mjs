// Checks for 20270101000000_oauth_signup_profile.sql (Google sign-in profiles). Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

export async function run(c) {
  await c.query(fs.readFileSync(process.env.MIG, 'utf8'))
  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)

  const signup = async (email, meta) => {
    const id = crypto.randomUUID()
    await c.query(`INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1,$2,$3)`, [id, email, JSON.stringify(meta)])
    const p = (await c.query(`SELECT first_name, last_name, nickname, avatar_url FROM public.profiles WHERE id=$1`, [id])).rows[0]
    const o = (await c.query(`SELECT welcome_seen_at, onboarding_dismissed_at FROM public.user_onboarding_state WHERE user_id=$1`, [id])).rows[0]
    return { id, p, o }
  }

  let r = await signup('ann@x.test', { first_name: ' Ann ', last_name: 'Lee' })
  ok('email signup: names from the form', r.p.first_name === 'Ann' && r.p.last_name === 'Lee' && r.p.nickname === null)
  ok('email signup: onboarding pending', r.o && !r.o.welcome_seen_at && !r.o.onboarding_dismissed_at)

  r = await signup('g1@x.test', { full_name: 'Ann Marie Lee', name: 'Ann Marie Lee', picture: 'https://lh3.googleusercontent.com/a/x', email_verified: true })
  ok('google: full_name split', r.p.first_name === 'Ann' && r.p.last_name === 'Marie Lee' && r.p.nickname === null)
  ok('google: external picture not stored (constraint)', r.p.avatar_url === null)
  ok('google: onboarding pending', r.o && !r.o.welcome_seen_at && !r.o.onboarding_dismissed_at)

  r = await signup('g2@x.test', { given_name: 'Bo', family_name: 'Chan', name: 'Zed' })
  ok('google: given/family name win', r.p.first_name === 'Bo' && r.p.last_name === 'Chan')

  r = await signup('g3@x.test', { name: 'Cher' })
  ok('google: single name', r.p.first_name === 'Cher' && r.p.last_name === null)

  r = await signup('rider.one@x.test', {})
  ok('no metadata: nickname from e-mail local part', r.p.nickname === 'rider.one' && r.p.first_name === null)

  const a = await signup('d1@x.test', { full_name: 'John Smith' })
  const b = await signup('d2@x.test', { full_name: 'John Smith' })
  ok('duplicate display names are fine', a.p.first_name === b.p.first_name && a.id !== b.id)

  r = await signup('nullmeta@x.test', null)
  ok('null metadata does not break signup', r.p.nickname === 'nullmeta')
}

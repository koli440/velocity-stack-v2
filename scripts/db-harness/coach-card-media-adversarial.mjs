// Adversarial checks for 20270157000000_coach_card_media.sql (coach card logo + banner). Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
async function as(c, user, sql, params = [], { commit = false } = {}) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query(commit ? 'COMMIT' : 'ROLLBACK')
    return { ok: true, rows: r.rows }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

export async function run(c) {
  for (const n of ['admin', 'coach', 'coach2']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach2], { commit: true })

  const url = (u, kind, n = 1, ext = 'png') => `https://x.supabase.co/storage/v1/object/public/coach-media/${u}/${kind}-${n}.${ext}`
  const card = (extra = {}) => ({ slug: 'media-coach', headline: 'h', ...extra })
  const save = (u, p) => as(c, u, `SELECT save_coach_card($1::jsonb) AS s`, [JSON.stringify(p)], { commit: true })
  const mine = async (u) => (await as(c, u, `SELECT my_coach_card() AS m`)).rows[0].m
  const vis = (u, pub, listed) => as(c, u, `SELECT set_coach_card_visibility($1, $2)`, [pub, listed], { commit: true })

  const b = (await c.query(`SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'coach-media'`)).rows[0]
  ok('coach-media bucket is public, 5 MB, images only', b && b.public && Number(b.file_size_limit) === 5242880
    && b.allowed_mime_types.join() === 'image/jpeg,image/png,image/webp')
  const pols = (await c.query(`SELECT policyname, cmd FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'coach_media_%'`)).rows
  ok('four own-prefix policies (select/insert/update/delete)', pols.length === 4)

  for (const [name, p] of [
    ['logo of another coach', card({ logo_url: url(U.coach2, 'logo') })],
    ['logo in the avatars bucket', card({ logo_url: `https://x.supabase.co/storage/v1/object/public/avatars/${U.coach}/logo-1.png` })],
    ['non-storage path', card({ logo_url: `https://x.supabase.co/evil/${U.coach}/logo-1.png` })],
    ['banner used as logo', card({ logo_url: url(U.coach, 'banner') })],
    ['logo used as banner', card({ banner_url: url(U.coach, 'logo') })],
    ['gif extension', card({ logo_url: url(U.coach, 'logo', 1, 'gif') })],
    ['query string', card({ logo_url: url(U.coach, 'logo') + '?x=1' })],
    ['credentials in url', card({ logo_url: `https://a@x.supabase.co/storage/v1/object/public/coach-media/${U.coach}/logo-1.png` })],
    ['path traversal', card({ banner_url: `https://x.supabase.co/storage/v1/object/public/coach-media/${U.coach}/../${U.coach2}/banner-1.png` })],
  ]) ok(`rejects ${name}`, !(await save(U.coach, p)).ok)
  ok('db check rejects a foreign logo url', !(await c.query(`INSERT INTO coach_cards(coach_id, slug, logo_url) VALUES ($1, 'zz-direct', $2)`, [U.coach, url(U.coach2, 'logo')]).then(() => true, () => false)))

  ok('own logo and banner are saved', (await save(U.coach, card({ logo_url: url(U.coach, 'logo', 5, 'webp'), banner_url: url(U.coach, 'banner', 6, 'jpg') }))).ok)
  const m = await mine(U.coach)
  ok('my_coach_card returns both', m.logo_url === url(U.coach, 'logo', 5, 'webp') && m.banner_url === url(U.coach, 'banner', 6, 'jpg'))

  ok('payload without the keys keeps the images', (await save(U.coach, card({ headline: 'changed' }))).ok
    && (await mine(U.coach)).logo_url === m.logo_url && (await mine(U.coach)).banner_url === m.banner_url)
  ok('replace the logo', (await save(U.coach, card({ logo_url: url(U.coach, 'logo', 9) }))).ok && (await mine(U.coach)).logo_url === url(U.coach, 'logo', 9)
    && (await mine(U.coach)).banner_url === m.banner_url)

  await vis(U.coach, true, true)
  const pub = (await as(c, null, `SELECT get_coach_card('media-coach') AS card`)).rows[0].card
  ok('public card exposes logo and banner', pub.logo_url === url(U.coach, 'logo', 9) && pub.banner_url === m.banner_url)
  ok('licence key still present', 'licence' in pub)
  const listed = (await as(c, null, `SELECT list_coaches() AS l`)).rows[0].l
  ok('directory entry exposes logo and banner', listed.length === 1 && listed[0].logo_url === url(U.coach, 'logo', 9) && listed[0].banner_url === m.banner_url)

  ok('empty string removes the logo', (await save(U.coach, card({ logo_url: '' }))).ok && (await mine(U.coach)).logo_url === null && (await mine(U.coach)).banner_url === m.banner_url)
  ok('null removes the banner', (await save(U.coach, card({ banner_url: null }))).ok && (await mine(U.coach)).banner_url === null)
  ok('removed images are no longer public', (await as(c, null, `SELECT get_coach_card('media-coach') AS card`)).rows[0].card.logo_url === null)
}

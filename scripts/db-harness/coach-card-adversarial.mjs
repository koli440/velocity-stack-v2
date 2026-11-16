// Adversarial checks for 20270152000000_coach_cards.sql (coach card, packages, directory, reports). Run with harness.mjs, see README.
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
  for (const n of ['admin', 'coach', 'coach2', 'viewer', 'blocked']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`UPDATE profiles SET avatar_url = 'https://x.supabase.co/storage/v1/object/public/avatars/' || id || '/a.png' WHERE id = $1`, [U.coach])
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1, $2)`, [U.coach, U.blocked])

  const card = (extra = {}) => ({ slug: 'speedy-coach', headline: 'Track endurance', bio: 'Hello **there**', accent: 'sky', disciplines: ['track', 'road'], languages: ['English'], location: 'Ghent', ...extra })
  const save = (u, p) => as(c, u, `SELECT save_coach_card($1::jsonb) AS s`, [JSON.stringify(p)], { commit: true })
  const get = (u, slug) => as(c, u, `SELECT get_coach_card($1) AS card`, [slug])
  const vis = (u, pub, listed) => as(c, u, `SELECT set_coach_card_visibility($1, $2)`, [pub, listed], { commit: true })
  const list = (u, ...a) => as(c, u, `SELECT list_coaches($1, $2) AS l`, [a[0] ?? null, a[1] ?? null])

  // Flag off: nothing works
  ok('save refused while flag off', !(await save(U.coach, card())).ok)
  ok('my card refused while flag off', !(await as(c, U.coach, `SELECT my_coach_card()`)).ok)
  ok('clients cannot read tables', !(await as(c, U.coach, `SELECT * FROM coach_cards`)).ok && !(await as(c, null, `SELECT * FROM coach_packages`)).ok)
  ok('anon cannot call save', !(await as(c, null, `SELECT save_coach_card('{}')`)).ok)
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach2], { commit: true })

  // Validation
  for (const [name, p] of [
    ['reserved slug', card({ slug: 'admin' })],
    ['too short slug', card({ slug: 'ab' })],
    ['bad chars slug', card({ slug: 'Bad_Slug!' })],
    ['leading dash slug', card({ slug: '-abc' })],
    ['long headline', card({ headline: 'x'.repeat(81) })],
    ['long bio', card({ bio: 'x'.repeat(1501) })],
    ['bad accent', card({ accent: 'url(javascript:1)' })],
    ['too many disciplines', card({ disciplines: Array(9).fill('a') })],
    ['7 packages', card({ packages: Array(7).fill({ title: 't', kind: 'free' }) })],
    ['subscription without interval', card({ packages: [{ title: 't', kind: 'subscription', amount_cents: 100 }] })],
    ['negative price', card({ packages: [{ title: 't', kind: 'one_time', amount_cents: -1 }] })],
    ['bad currency', card({ packages: [{ title: 't', kind: 'one_time', amount_cents: 1, currency: 'btc' }] })],
    ['empty package title', card({ packages: [{ title: ' ', kind: 'free' }] })],
    ['max_athletes 0', card({ max_athletes: 0 })],
  ]) ok(`rejects ${name}`, !(await save(U.coach, p)).ok)
  ok('nothing saved by failed attempts', (await c.query(`SELECT count(*)::int n FROM coach_cards`)).rows[0].n === 0)

  const saved = await save(U.coach, card({ packages: [
    { title: 'Monthly plan', kind: 'subscription', interval: 'month', amount_cents: 8000, description: 'Weekly plan' },
    { title: 'Intro call', kind: 'free' },
  ] }))
  ok('db rejects a priced free package', !(await c.query(`INSERT INTO coach_packages(coach_id,title,kind,amount_cents) VALUES ($1,'x','free',5)`, [U.coach]).then(() => true, () => false)))
  ok('coach saves a card', saved.ok && saved.rows[0].s === 'speedy-coach')
  ok('slug availability', (await as(c, U.coach2, `SELECT coach_card_slug_available('speedy-coach') AS a`)).rows[0].a === false
    && (await as(c, U.coach, `SELECT coach_card_slug_available('speedy-coach') AS a`)).rows[0].a === true
    && (await as(c, U.coach2, `SELECT coach_card_slug_available('admin') AS a`)).rows[0].a === false)
  ok('slug taken by other coach', !(await save(U.coach2, card())).ok)
  ok('slug is case-insensitive taken', !(await save(U.coach2, card({ slug: 'Speedy-Coach' }))).ok)

  // Privacy of unpublished card
  ok('unpublished card is not found (anon)', (await get(null, 'speedy-coach')).rows[0].card === null)
  ok('unpublished card is not found (owner via public RPC)', (await get(U.coach, 'speedy-coach')).rows[0].card === null)
  const mine = (await as(c, U.coach, `SELECT my_coach_card() AS m`)).rows[0].m
  ok('owner sees own unpublished card with packages', mine.is_public === false && mine.packages.length === 2)
  ok('other coach has no card', (await as(c, U.coach2, `SELECT my_coach_card() AS m`)).rows[0].m === null)

  // Publish
  ok('cannot list without a card', !(await vis(U.coach2, true, true)).ok)
  ok('publish', (await vis(U.coach, true, false)).ok)
  const pub = (await get(null, 'Speedy-Coach')).rows[0].card
  ok('anon reads public card (slug case-insensitive)', pub && pub.name === 'coach' && pub.headline === 'Track endurance')
  ok('public card has no private fields', !('email' in pub) && !JSON.stringify(pub).includes('stripe') && !('is_listed' in pub))
  ok('avatar url from the avatars bucket is exposed', /\/storage\/v1\/object\/public\/avatars\//.test(pub.avatar_url))
  ok('public card lists packages', pub.packages.length === 2 && pub.packages[0].title === 'Monthly plan' && pub.packages[0].interval === 'month')
  ok('blocked viewer gets not found', (await get(U.blocked, 'speedy-coach')).rows[0].card === null)
  ok('other viewer sees it', (await get(U.viewer, 'speedy-coach')).rows[0].card !== null)

  // Flag per coach: removing the coach from allow-list hides the page
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, false)`, [U.coach], { commit: true })
  ok('card hidden when coach loses the module', (await get(null, 'speedy-coach')).rows[0].card === null)
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })

  // Directory is opt-in
  ok('not listed by default', JSON.parse(JSON.stringify((await list(null)).rows[0].l)).length === 0)
  ok('list', (await vis(U.coach, true, true)).ok)
  ok('anon sees listed coach', (await list(null)).rows[0].l.length === 1)
  ok('listed entries have no ids or bio', !('coach_id' in (await list(null)).rows[0].l[0]) && !('bio' in (await list(null)).rows[0].l[0]))
  ok('search by name/location/discipline', (await list(null, 'ghent')).rows[0].l.length === 1 && (await list(null, null, 'track')).rows[0].l.length === 1
    && (await list(null, 'nomatch')).rows[0].l.length === 0 && (await list(null, null, 'swim')).rows[0].l.length === 0)
  ok('wildcards are escaped', (await list(null, '%')).rows[0].l.length === 0 && (await list(null, '_')).rows[0].l.length === 0)
  ok('blocked viewer does not see the listing', (await list(U.blocked)).rows[0].l.length === 0)
  ok('unpublish also unlists', (await vis(U.coach, false, true)).ok
    && (await list(null)).rows[0].l.length === 0 && (await get(null, 'speedy-coach')).rows[0].card === null)
  const flags = (await c.query(`SELECT is_public, is_listed FROM coach_cards WHERE coach_id=$1`, [U.coach])).rows[0]
  ok('listed cannot outlive public', flags.is_public === false && flags.is_listed === false)
  ok('db rejects listed without public', !(await c.query(`UPDATE coach_cards SET is_listed = TRUE WHERE coach_id=$1`, [U.coach]).then(() => true, () => false)))
  await vis(U.coach, true, true)

  // Package sync: update by id, delete missing, cannot touch another coach's package
  const pk = (await as(c, U.coach, `SELECT my_coach_card() AS m`)).rows[0].m.packages
  const resave = await save(U.coach, card({ packages: [{ ...pk[0], title: 'Renamed', amount_cents: 9000 }] }))
  ok('package update + removal of missing', resave.ok)
  const after = (await as(c, U.coach, `SELECT my_coach_card() AS m`)).rows[0].m.packages
  ok('package synced', after.length === 1 && after[0].id === pk[0].id && after[0].title === 'Renamed' && after[0].amount_cents === 9000)
  ok('cannot reference another coach package', !(await save(U.coach2, card({ slug: 'other-coach', packages: [{ ...pk[0] }] }))).ok)
  ok('other coach package untouched', (await c.query(`SELECT count(*)::int n FROM coach_packages WHERE id=$1`, [pk[0].id])).rows[0].n === 1)

  // Waitlist
  await save(U.coach, card({ max_athletes: 1 }))
  await c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at) VALUES ($1,$2,'active',$1,now())`, [U.coach, U.viewer])
  ok('waitlist flag when cap reached', (await get(null, 'speedy-coach')).rows[0].card.waitlist === true)

  // Reports
  ok('anon cannot report', !(await as(c, null, `SELECT report_coach_card('speedy-coach', 'x')`)).ok)
  ok('empty reason rejected', !(await as(c, U.viewer, `SELECT report_coach_card('speedy-coach', '  ')`)).ok)
  ok('unknown card report rejected', !(await as(c, U.viewer, `SELECT report_coach_card('nope-nope', 'x')`)).ok)
  ok('viewer reports', (await as(c, U.viewer, `SELECT report_coach_card('speedy-coach', 'spam')`, [], { commit: true })).ok)
  ok('repeat report upserts (one row)', (await as(c, U.viewer, `SELECT report_coach_card('speedy-coach', 'still spam')`, [], { commit: true })).ok
    && (await c.query(`SELECT count(*)::int n FROM coach_card_reports`)).rows[0].n === 1)
  ok('non-admin cannot read reports', !(await as(c, U.viewer, `SELECT * FROM admin_coach_card_reports()`)).ok)
  const reps = await as(c, U.admin, `SELECT * FROM admin_coach_card_reports()`)
  ok('admin sees reports', reps.ok && reps.rows.length === 1 && reps.rows[0].reason === 'still spam')
  ok('non-admin cannot resolve', !(await as(c, U.viewer, `SELECT admin_resolve_coach_card_report($1, true)`, [reps.rows[0].id])).ok)
  ok('admin resolves and unpublishes', (await as(c, U.admin, `SELECT admin_resolve_coach_card_report($1, true)`, [reps.rows[0].id], { commit: true })).ok
    && (await get(null, 'speedy-coach')).rows[0].card === null)

  // Rate limit
  let limited = false
  for (let i = 0; i < 65 && !limited; i++) limited = !(await save(U.coach, card({ headline: 'edit ' + i }))).ok
  ok('card edits are rate limited', limited)

  // Cascade
  await c.query(`DELETE FROM profiles WHERE id = $1`, [U.coach2])
  ok('profile delete cascades', (await c.query(`SELECT count(*)::int n FROM coach_cards WHERE coach_id=$1`, [U.coach2])).rows[0].n === 0)
}

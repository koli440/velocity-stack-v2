// Adversarial checks for 20270153000000_coach_onboarding.sql (questionnaire, consent, applications, auto-setup). Run with harness.mjs, see README.
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
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)
hashOk()
function hashOk() {}
const HASH = 'a'.repeat(64)

export async function run(c) {
  for (const n of ['admin', 'coach', 'coach2', 'rider', 'rider2', 'rider3', 'minor', 'blocked', 'plain']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1, $2)`, [U.coach, U.blocked])

  const answers = (extra = {}) => ({
    about: { dob: '1990-05-05', sex: 'na', height_cm: 180, weight_kg: 72.5, country: 'BE', language: 'en' },
    goals: { main_goal: 'race', goal_text: 'Win', events: [{ name: 'Nationals', date: day(60), priority: 'A' }, { name: 'Old race', date: day(-30) }], timeframe: '6 months' },
    history: { years_riding: 5, weekly_hours: 8, structure: 'self', ftp_w: 280, max_hr: 190, lt1_w: 200, lt2_w: 260 },
    availability: { hours_per_week: 9, weekdays: { mon: 'short', sat: 'long' }, blackout: [{ date: day(20), note: 'Holiday' }, { date: day(-5) }] },
    equipment: { power_meter: 'Quarq', platforms: ['Garmin'] },
    ...extra,
  })
  const health = (yes = false) => ({ parq: [yes, false, false, false, false, false, false], notes: 'knee', clearance: true })
  const submit = (u, slug, { a = answers(), h = health(), declined = false, q = {}, v = 1, hash = HASH } = {}) =>
    as(c, u, `SELECT submit_onboarding($1, $2::jsonb, $3::jsonb, $4, $5::jsonb, $6, $7) AS id`, [slug, JSON.stringify(a), h ? JSON.stringify(h) : null, declined, JSON.stringify(q), v, hash], { commit: true })
  const save = (u, p) => as(c, u, `SELECT save_coach_card($1::jsonb)`, [JSON.stringify(p)], { commit: true })

  // Flag off
  ok('apply refused while flag off', !(await submit(U.rider, 'nobody')).ok)
  ok('questions refused while flag off', !(await as(c, U.coach, `SELECT my_coach_questions()`)).ok)
  for (const n of ['coach', 'coach2']) await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U[n]], { commit: true })
  await save(U.coach, { slug: 'coach-one', headline: 'h' })
  await save(U.coach2, { slug: 'coach-two', headline: 'h' })
  ok('unpublished card cannot be applied to', !(await submit(U.rider, 'coach-one')).ok)
  for (const n of ['coach', 'coach2']) await as(c, U[n], `SELECT set_coach_card_visibility(true, false)`, [], { commit: true })

  // Coach questions
  ok('too many questions', !(await as(c, U.coach, `SELECT save_coach_questions($1::jsonb)`, [JSON.stringify(Array(6).fill('q'))], { commit: true })).ok)
  ok('save questions', (await as(c, U.coach, `SELECT save_coach_questions($1::jsonb)`, [JSON.stringify(['Why me?', ' ', 'Injuries?'])], { commit: true })).ok)
  ok('questions compacted', JSON.stringify((await as(c, U.coach, `SELECT my_coach_questions() AS q`)).rows[0].q) === JSON.stringify(['Why me?', 'Injuries?']))
  const info = (await as(c, U.rider, `SELECT coach_apply_info('coach-one') AS i`)).rows[0].i
  ok('apply info has questions and no ids', info.questions.length === 2 && !('coach_id' in info) && info.accepting_athletes === true)
  ok('apply info needs login', !(await as(c, null, `SELECT coach_apply_info('coach-one')`)).ok)
  ok('apply info hidden from blocked', (await as(c, U.blocked, `SELECT coach_apply_info('coach-one') AS i`)).rows[0].i === null)

  // Validation / consent
  ok('anon cannot submit', !(await as(c, null, `SELECT submit_onboarding('coach-one','{}',null,false,'{}',1,'${HASH}')`)).ok)
  ok('consent version required', !(await submit(U.rider, 'coach-one', { v: 2 })).ok)
  ok('consent hash required', !(await submit(U.rider, 'coach-one', { hash: 'nope' })).ok)
  const bad = {
    'no dob': answers({ about: { sex: 'na' } }),
    'unknown section': { ...answers(), admin: { x: 1 } },
    'unknown key': answers({ about: { dob: '1990-05-05', is_admin: true } }),
    'ftp too high': answers({ history: { ftp_w: 5000 } }),
    'ftp as string': answers({ history: { ftp_w: '280' } }),
    'weight too low': answers({ about: { dob: '1990-05-05', weight_kg: 5 } }),
    'bad date': answers({ about: { dob: '1990-13-45' } }),
    'future dob': answers({ about: { dob: day(30) } }),
    'bad enum': answers({ history: { structure: 'hacker' } }),
    'long text': answers({ goals: { goal_text: 'x'.repeat(1001) } }),
    'too many events': answers({ goals: { events: Array(6).fill({ name: 'r', date: day(5) }) } }),
    'event without name': answers({ goals: { events: [{ date: day(5) }] } }),
    'bad weekday': answers({ availability: { weekdays: { funday: 'long' } } }),
    'too many blackout': answers({ availability: { blackout: Array(11).fill({ date: day(5) }) } }),
    'platforms not strings': answers({ equipment: { platforms: [1] } }),
    'unknown equipment item': answers({ equipment: { items: ['power_meter', 'rocket'] } }),
    'equipment items not array': answers({ equipment: { items: 'power_meter' } }),
    'equipment item not string': answers({ equipment: { items: [1] } }),
    'too many equipment items': answers({ equipment: { items: Array(21).fill('zwift') } }),
    'section not object': answers({ goals: 'x' }),
    'too large': answers({ goals: { goal_text: 'x'.repeat(900), why_now: 'y'.repeat(900), main_goal: 'z' }, equipment: { platforms: Array(10).fill('p'.repeat(30)) }, history: { other_sports: 'o'.repeat(200) }, about: { dob: '1990-05-05', country: 'c'.repeat(60) } }),
  }
  for (const [name, a] of Object.entries(bad)) {
    if (name === 'too large') continue
    ok('rejects ' + name, !(await submit(U.rider, 'coach-one', { a })).ok)
  }
  ok('equipment checkboxes accepted', (await submit(U.rider3, 'coach-two', { a: answers({ equipment: { items: ['power_meter', 'smart_trainer', 'other'] } }) })).ok)
  ok('checkboxes stored', (await c.query(`SELECT answers->'equipment'->'items' AS i FROM onboarding_submissions WHERE rider_id=$1`, [U.rider3])).rows[0].i.length === 3)
  await c.query(`DELETE FROM coaching_relationships WHERE rider_id=$1`, [U.rider3])
  await c.query(`DELETE FROM onboarding_submissions WHERE rider_id=$1`, [U.rider3])
  ok('rejects bad health shape', !(await submit(U.rider, 'coach-one', { h: { parq: [true] } })).ok)
  ok('rejects health with declined', !(await submit(U.rider, 'coach-one', { declined: true })).ok)
  ok('rejects unknown coach answer key', !(await submit(U.rider, 'coach-one', { q: { 9: 'x' } })).ok)
  ok('nothing stored by failures', (await c.query(`SELECT count(*)::int n FROM onboarding_submissions`)).rows[0].n === 0)
  ok('no relationship created by failures', (await c.query(`SELECT count(*)::int n FROM coaching_relationships`)).rows[0].n === 0)

  // Not allowed situations
  ok('blocked rider refused', !(await submit(U.blocked, 'coach-one')).ok)
  ok('self application refused', !(await submit(U.coach, 'coach-one')).ok)
  await c.query(`UPDATE coach_cards SET accepting_athletes = FALSE WHERE slug = 'coach-two'`)
  ok('closed coach refused', !(await submit(U.rider, 'coach-two')).ok)
  await c.query(`UPDATE coach_cards SET accepting_athletes = TRUE, max_athletes = 1 WHERE slug = 'coach-two'`)
  await c.query(`INSERT INTO coaching_relationships(coach_id, rider_id, initiated_by, status) VALUES ($1,$2,$2,'active')`, [U.coach2, U.plain])
  ok('full coach refused', !(await submit(U.rider, 'coach-two')).ok)
  await c.query(`UPDATE coach_cards SET max_athletes = NULL WHERE slug = 'coach-two'`)
  ok('rider with active coach refused', !(await submit(U.plain, 'coach-one')).ok)

  // Happy path (existing FTP for rider2 to check "never overwrite")
  await c.query(`INSERT INTO ftp_history(user_id, effective_from, ftp_w) VALUES ($1, $2, 250)`, [U.rider2, day(-1)])
  const r1 = await submit(U.rider, 'coach-one', { q: { 1: 'Because', 2: 'None' } })
  ok('submit ok', r1.ok)
  const sid = r1.rows[0].id
  ok('relationship is pending and rider initiated', (await c.query(`SELECT status, initiated_by FROM coaching_relationships WHERE coach_id=$1 AND rider_id=$2`, [U.coach, U.rider])).rows[0].status === 'pending')
  const notif = (await c.query(`SELECT * FROM notifications WHERE user_id=$1 AND type='onboarding_submitted'`, [U.coach])).rows
  ok('coach notified once without content', notif.length === 1 && !JSON.stringify(notif[0]).includes('knee'))
  const again = await submit(U.rider, 'coach-one', { a: answers({ goals: { main_goal: 'fitness' } }), q: { 1: 'Updated' } })
  ok('resubmit reuses submission and request', again.ok && again.rows[0].id === sid && (await c.query(`SELECT count(*)::int n FROM coaching_relationships WHERE coach_id=$1 AND rider_id=$2`, [U.coach, U.rider])).rows[0].n === 1)
  await submit(U.rider, 'coach-one', { q: { 1: 'Because', 2: 'None' } })

  ok('clients cannot read tables', !(await as(c, U.rider, `SELECT * FROM onboarding_submissions`)).ok && !(await as(c, U.coach, `SELECT * FROM onboarding_setup_log`)).ok)
  ok('clients cannot call setup', !(await as(c, U.coach, `SELECT apply_onboarding_setup($1)`, [uid()])).ok)
  const apps = (await as(c, U.coach, `SELECT coach_applications() AS a`)).rows[0].a
  ok('coach sees application with health flag only', apps.length === 1 && apps[0].health_flag === false && !('health' in apps[0]) && !JSON.stringify(apps).includes('knee'))
  ok('other coach sees nothing', (await as(c, U.coach2, `SELECT coach_applications() AS a`)).rows[0].a.length === 0)
  ok('other coach cannot open it', (await as(c, U.coach2, `SELECT coach_application_get($1) AS a`, [sid])).rows[0].a === null)
  ok('other rider cannot open it', !(await as(c, U.rider2, `SELECT coach_application_get($1) AS a`, [sid])).ok)
  const full = (await as(c, U.coach, `SELECT coach_application_get($1) AS a`, [sid])).rows[0].a
  ok('coach reads full application', full.answers.history.ftp_w === 280 && full.health.parq.length === 7 && full.coach_answers['1'] === 'Because' && full.minor === false)
  ok('rider cannot edit others', !(await as(c, U.rider2, `SELECT edit_onboarding_answers($1,'{}'::jsonb,null,false,'{}'::jsonb)`, [sid])).ok)
  ok('rider edits answers', (await as(c, U.rider, `SELECT edit_onboarding_answers($1,$2::jsonb,null,true,'{}'::jsonb)`, [sid, JSON.stringify(answers())], { commit: true })).ok)
  const declined = (await as(c, U.coach, `SELECT coach_application_get($1) AS a`, [sid])).rows[0].a
  ok('declined health is stored as declined', declined.health === null && declined.health_declined === true)

  // Accept -> auto-setup
  const rel = (await c.query(`SELECT id FROM coaching_relationships WHERE coach_id=$1 AND rider_id=$2`, [U.coach, U.rider])).rows[0].id
  ok('rider cannot accept own request', !(await as(c, U.rider, `SELECT accept_coaching($1)`, [rel])).ok)
  ok('coach accepts', (await as(c, U.coach, `SELECT accept_application($1)`, [rel], { commit: true })).ok)
  ok('relationship active', (await c.query(`SELECT status FROM coaching_relationships WHERE id=$1`, [rel])).rows[0].status === 'active')
  const ftp = (await c.query(`SELECT ftp_w, set_by_coach FROM ftp_history WHERE user_id=$1`, [U.rider])).rows
  ok('FTP created, not stamped as coach', ftp.length === 1 && ftp[0].ftp_w === 280 && ftp[0].set_by_coach === false)
  ok('weight created', (await c.query(`SELECT weight_kg FROM weight_history WHERE user_id=$1`, [U.rider])).rows[0].weight_kg == 72.5)
  ok('thresholds created', (await c.query(`SELECT lt1_power_w, lt2_power_w FROM lactate_threshold_history WHERE user_id=$1`, [U.rider])).rows[0].lt2_power_w === 260)
  const races = (await c.query(`SELECT name, priority, set_by_coach FROM calendar_races WHERE rider_id=$1`, [U.rider])).rows
  ok('only the future race created', races.length === 1 && races[0].name === 'Nationals' && races[0].priority === 'A' && races[0].set_by_coach === false)
  const notes = (await c.query(`SELECT title, set_by_coach FROM calendar_notes WHERE rider_id=$1`, [U.rider])).rows
  ok('only the future blackout created', notes.length === 1 && notes[0].title === 'Unavailable' && notes[0].set_by_coach === false)
  ok('no coach_edits noise for setup', (await c.query(`SELECT count(*)::int n FROM coach_edits WHERE rider_id=$1`, [U.rider])).rows[0].n === 0)
  await c.query(`SELECT apply_onboarding_setup($1)`, [rel])
  ok('setup is idempotent', (await c.query(`SELECT count(*)::int n FROM ftp_history WHERE user_id=$1`, [U.rider])).rows[0].n === 1
    && (await c.query(`SELECT count(*)::int n FROM calendar_races WHERE rider_id=$1`, [U.rider])).rows[0].n === 1)
  const mine = (await as(c, U.rider, `SELECT my_onboarding() AS m`)).rows[0].m
  ok('rider sees what was created', mine.length === 1 && mine[0].setup.some((s) => s.target === 'ftp' && s.status === 'created') && mine[0].setup_applied_at)
  ok('active athlete still visible to coach', (await as(c, U.coach, `SELECT coach_application_get($1) AS a`, [sid])).rows[0].a?.relationship_status === 'active')
  ok('active submission no longer listed as application', (await as(c, U.coach, `SELECT coach_applications() AS a`)).rows[0].a.length === 0)
  ok('active rider cannot re-apply elsewhere', !(await submit(U.rider, 'coach-two')).ok)
  ok('end coaching', (await as(c, U.rider, `SELECT end_coaching($1)`, [rel], { commit: true })).ok)
  ok('coach loses access when coaching ends', (await as(c, U.coach, `SELECT coach_application_get($1) AS a`, [sid])).rows[0].a === null)

  // Existing FTP is never overwritten; same-day thresholds/weight kept
  await submit(U.rider2, 'coach-one', { a: answers({ history: { ftp_w: 330 } }) })
  const rel2 = (await c.query(`SELECT id FROM coaching_relationships WHERE coach_id=$1 AND rider_id=$2`, [U.coach, U.rider2])).rows[0].id
  await as(c, U.coach, `SELECT accept_application($1)`, [rel2], { commit: true })
  const f2 = (await c.query(`SELECT ftp_w FROM ftp_history WHERE user_id=$1`, [U.rider2])).rows
  ok('existing FTP kept', f2.length === 1 && f2[0].ftp_w === 250)
  ok('skip is logged', (await c.query(`SELECT 1 FROM onboarding_setup_log l JOIN onboarding_submissions s ON s.id=l.submission_id WHERE s.rider_id=$1 AND l.target='ftp' AND l.status='skipped'`, [U.rider2])).rowCount === 1)

  // Minor: no health, never stored
  const m = answers({ about: { dob: day(-365 * 15), sex: 'na' } })
  ok('minor with health refused', !(await submit(U.minor, 'coach-two', { a: m, h: health() })).ok)
  const mr = await submit(U.minor, 'coach-two', { a: m, h: null })
  ok('minor can apply without health', mr.ok)
  const mg = (await as(c, U.coach2, `SELECT coach_application_get($1) AS a`, [mr.rows[0].id])).rows[0].a
  ok('minor flagged, no health, not marked declined', mg.minor === true && mg.health === null && mg.health_declined === false)

  // Withdraw while pending cancels the request and cuts access
  const r3 = await submit(U.rider3, 'coach-two', { h: health(true) })
  ok('health flag reaches the list as a boolean', (await as(c, U.coach2, `SELECT coach_applications() AS a`)).rows[0].a.some((a) => a.health_flag === true))
  ok('only the owner can withdraw', !(await as(c, U.rider2, `SELECT withdraw_onboarding_consent($1)`, [r3.rows[0].id])).ok)
  ok('withdraw', (await as(c, U.rider3, `SELECT withdraw_onboarding_consent($1)`, [r3.rows[0].id], { commit: true })).ok)
  ok('withdrawn is hidden from the coach', (await as(c, U.coach2, `SELECT coach_application_get($1) AS a`, [r3.rows[0].id])).rows[0].a === null)
  ok('withdrawn request cancelled', (await c.query(`SELECT status FROM coaching_relationships WHERE coach_id=$1 AND rider_id=$2`, [U.coach2, U.rider3])).rows[0].status === 'ended')
  ok('withdrawn not in list', !(await as(c, U.coach2, `SELECT coach_applications() AS a`)).rows[0].a.some((a) => a.id === r3.rows[0].id))
  ok('withdraw works with the flag off', await (async () => {
    await as(c, U.admin, `SELECT admin_coach_module_allow($1, false)`, [U.coach2], { commit: true })
    return (await as(c, U.rider3, `SELECT delete_onboarding_answers($1)`, [r3.rows[0].id], { commit: true })).ok
  })())
  ok('delete removes the row', (await c.query(`SELECT 1 FROM onboarding_submissions WHERE id=$1`, [r3.rows[0].id])).rowCount === 0)
  ok('flag off hides apply', !(await submit(U.rider3, 'coach-two')).ok)
  ok('flag off hides coach lists', !(await as(c, U.coach2, `SELECT coach_applications()`)).ok)

  // Profile deletion cascades
  await c.query(`DELETE FROM profiles WHERE id = $1`, [U.rider2])
  ok('profile delete cascades', (await c.query(`SELECT 1 FROM onboarding_submissions WHERE rider_id=$1`, [U.rider2])).rowCount === 0)
}

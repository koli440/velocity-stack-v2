// Prototype (issue #336): print the gym LOAD breakdown for one gym activity. Read-only, nothing is stored,
// no effect on fitness. Uses the RIDER'S OWN access token (RLS applies); no service-role key is needed.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... USER_ACCESS_TOKEN=<your session JWT> \
//     node scripts/gym-load.mjs <activity-id>      # one session
//     node scripts/gym-load.mjs --latest           # your latest gym session
//     node scripts/gym-load.mjs --file session.json  # offline: { exercises, durationS, avgHr, priorExercises, priorAvgHrs }
//
// SUPABASE_URL / SUPABASE_ANON_KEY are the public NEXT_PUBLIC_* values; the token is the access_token of your
// signed-in session (browser devtools -> Application -> Local Storage -> sb-...-auth-token).
import { readFileSync } from 'node:fs'
import { fetchGymDetail } from '../src/lib/gymDetail.js'
import { computeGymLoad, summarizeHistory, typicalGymHr } from '../src/lib/gymLoad.js'

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: node scripts/gym-load.mjs <activity-id> | --latest | --file session.json')
  process.exit(1)
}

let input
if (arg === '--file') {
  input = JSON.parse(readFileSync(process.argv[3], 'utf8'))
  input = { ...input, history: summarizeHistory(input.priorExercises), typicalHr: typicalGymHr(input.priorAvgHrs) }
} else {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, USER_ACCESS_TOKEN } = process.env
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !USER_ACCESS_TOKEN) {
    console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY and USER_ACCESS_TOKEN (see the header of this script).')
    process.exit(1)
  }
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${USER_ACCESS_TOKEN}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const cols = 'id, user_id, activity_date, elapsed_time_s, moving_time_s, avg_hr'
  const q = arg === '--latest'
    ? db.from('activities').select(cols).eq('activity_type', 'gym').order('activity_date', { ascending: false }).limit(1)
    : db.from('activities').select(cols).eq('id', arg).eq('activity_type', 'gym').limit(1)
  const { data: acts, error } = await q
  if (error || !acts?.length) {
    console.error(error?.message || 'No such gym activity visible to this token')
    process.exit(1)
  }
  const act = acts[0]
  const detail = await fetchGymDetail(db, act.id)
  if (!detail) {
    console.error('This session has no set detail (summary-only source).')
    process.exit(1)
  }
  const exercises = detail.exercises.map((e) => ({ ...e, name_key: undefined }))
  const keys = [...new Set((await db.from('gym_exercises').select('id, name_key').eq('activity_id', act.id)).data?.map((r) => r.name_key) ?? [])]
  const { data: prior } = await db.from('gym_exercises')
    .select('id, activity_id, name_key, activities!inner(activity_date)')
    .eq('user_id', act.user_id).in('name_key', keys).lt('activities.activity_date', act.activity_date).neq('activity_id', act.id)
  const ids = (prior || []).map((p) => p.id)
  const { data: priorSets } = ids.length ? await db.from('gym_sets').select('exercise_id, set_type, kind, load_mode, reps, weight_kg, metrics').in('exercise_id', ids) : { data: [] }
  const priorExercises = (prior || []).map((p) => ({ activity_id: p.activity_id, name_key: p.name_key, sets: (priorSets || []).filter((s) => s.exercise_id === p.id) }))
  const { data: prevGym } = await db.from('activities').select('avg_hr').eq('user_id', act.user_id).eq('activity_type', 'gym').lt('activity_date', act.activity_date).not('avg_hr', 'is', null).order('activity_date', { ascending: false }).limit(30)
  input = {
    exercises,
    durationS: act.elapsed_time_s ?? act.moving_time_s,
    avgHr: act.avg_hr,
    history: summarizeHistory(priorExercises),
    typicalHr: typicalGymHr((prevGym || []).map((r) => r.avg_hr)),
  }
  console.log(`Activity ${act.id} (${act.activity_date})`)
}

console.log(JSON.stringify(computeGymLoad(input), null, 2))

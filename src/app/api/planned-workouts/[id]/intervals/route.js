import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../../lib/server/connections'
import { PushError } from '../../../../../lib/server/intervalsEvents'
import { pushPlannedWorkout, removePlannedWorkoutPush } from '../../../../../lib/server/plannedPush'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMNS = 'id, rider_id, workout_date, discipline, title, description, structure_dsl, structure_manifest, status, activity_id'

function fail(err) {
  if (err instanceof PushError) {
    return NextResponse.json({ error: err.message, code: err.code, settingsUrl: err.code === 'not_connected' || err.fatal ? '/settings' : undefined }, { status: err.status })
  }
  return NextResponse.json({ error: 'Could not reach Intervals.icu right now.' }, { status: 500 })
}

// Authorisation = the request-scoped (RLS) client can see the workout: the rider, or the rider's ACTIVE coach.
// Only after that is the athlete's connection loaded, with the service role, inside plannedPush.js.
async function authorise(req, id) {
  if (!UUID.test(id)) return { res: NextResponse.json({ error: 'Planned workout not found' }, { status: 404 }) }
  const { supabase, user } = await getRequestUser(req)
  if (!user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: workout } = await supabase.from('planned_workouts').select(COLUMNS).eq('id', id).maybeSingle()
  if (!workout) return { res: NextResponse.json({ error: 'Planned workout not found' }, { status: 404 }) }
  const service = getServiceClient()
  if (!service) return { res: NextResponse.json({ error: 'Sending workouts to Intervals.icu is not available on this server.' }, { status: 503 }) }
  return { workout, service }
}

// Push or update the workout in the rider's Intervals.icu calendar.
export async function POST(req, { params }) {
  try {
    const a = await authorise(req, params.id)
    if (a.res) return a.res
    if (a.workout.status !== 'planned') {
      return NextResponse.json({ error: 'Skipped workouts are not sent to Intervals.icu.' }, { status: 409 })
    }
    const r = await pushPlannedWorkout({ service: a.service, workout: a.workout })
    return NextResponse.json({ success: true, state: r.state, warnings: r.warnings, recreated: r.recreated })
  } catch (err) {
    return fail(err)
  }
}

// Remove the workout's event from Intervals.icu (the planned workout itself stays).
export async function DELETE(req, { params }) {
  try {
    const a = await authorise(req, params.id)
    if (a.res) return a.res
    const r = await removePlannedWorkoutPush({ service: a.service, riderId: a.workout.rider_id, workoutId: a.workout.id })
    return NextResponse.json({ success: true, removed: r.removed })
  } catch (err) {
    return fail(err)
  }
}

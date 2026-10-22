import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { visibleTemplatesFilter } from '../../../../lib/ownerScope'
import { coachRunnableTemplates, resolveRunScope } from '../../../../lib/coachRuns'
import { parseActivityIds, runTemplateBatch, ownStore, coachStore } from '../../../../lib/server/templateBatchRun'

// POST /api/templates/run-batch  { templateId, activityIds: [<= 10], rider? }
// Runs one template on several activities (issue #293); the client sends a larger list (max 50) in chunks.
// Own account: the caller's activities only. With `rider` (athlete context) the caller must be the rider's
// active coach and may only use his own / system templates; inputs and writes go through coach-safe RPCs.
// Existing run of the same template: replaced in place (re-run).
export async function POST(req) {
  try {
    const { supabase, user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { templateId } = body
    if (typeof templateId !== 'string' || !templateId) return NextResponse.json({ error: 'Missing templateId' }, { status: 400 })
    const parsed = parseActivityIds(body.activityIds)
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const scope = resolveRunScope(body.rider, user.id)
    const { data: found } = await supabase.from('analysis_templates').select('*').or(visibleTemplatesFilter(user.id)).eq('id', templateId).limit(1)
    let template = (found || [])[0]
    if (template && scope.coachId) [template] = coachRunnableTemplates([template], user.id)
    if (!template) return NextResponse.json({ error: 'Template not available' }, { status: 404 })

    const store = scope.coachId ? coachStore(supabase, user.id, scope.ownerId, template.id) : ownStore(supabase, user.id, template.id)
    const items = await runTemplateBatch(parsed.ids, template, store)
    return NextResponse.json({ success: true, items })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60

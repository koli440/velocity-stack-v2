// Pure helpers + permission rules for the /templates page and its API routes.

export const TEMPLATE_TABS = ['mine', 'favorites', 'public', 'system']

export function isSystemTemplate(t) {
  return !t.user_id
}

export function isOwnTemplate(t, userId) {
  return !!userId && t.user_id === userId
}

// Single source of truth for what a viewer may do; the API and RLS enforce the same rules.
export function templatePermissions(t, userId) {
  const own = isOwnTemplate(t, userId)
  return {
    canEdit: own,
    canToggleVisibility: own,
    canDelete: own && t.visibility === 'private',
    canFavorite: !!userId,
  }
}

export function visibleTabs(userId) {
  return userId ? TEMPLATE_TABS : ['public', 'system']
}

export function filterByTab(templates, tab, { userId, favoriteIds = new Set() } = {}) {
  switch (tab) {
    case 'mine':
      return templates.filter((t) => isOwnTemplate(t, userId))
    case 'favorites':
      return templates.filter((t) => favoriteIds.has(t.id))
    case 'public':
      return templates.filter((t) => !isSystemTemplate(t) && t.visibility === 'public')
    case 'system':
      return templates.filter(isSystemTemplate)
    default:
      return []
  }
}

export function searchTemplates(templates, { query = '', category = 'all', sort = 'name' } = {}) {
  const q = query.trim().toLowerCase()
  const out = templates.filter((t) => {
    if (category !== 'all' && t.category !== category) return false
    if (!q) return true
    return [t.name, t.description, t.category].some((v) => (v || '').toLowerCase().includes(q))
  })
  const by = {
    name: (a, b) => (a.name || '').localeCompare(b.name || ''),
    updated: (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0),
    category: (a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || ''),
  }
  return out.sort(by[sort] || by.name)
}

// --- Server-side logic (client injected so it is unit-testable) -------------------------

// Resolve a template by slug through RLS (so invisible templates read as "not found").
export async function addFavorite(supabase, user, slug) {
  if (!user) return { status: 401, error: 'Unauthorized' }
  const { data: tpl, error: tplErr } = await supabase
    .from('analysis_templates')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (tplErr || !tpl) return { status: 404, error: 'Template not found' }

  const { error } = await supabase
    .from('template_favorites')
    .upsert({ user_id: user.id, template_id: tpl.id }, { onConflict: 'user_id,template_id' })
  if (error) return { status: 400, error: error.message }
  return { status: 200, body: { success: true, favorited: true } }
}

export async function removeFavorite(supabase, user, slug) {
  if (!user) return { status: 401, error: 'Unauthorized' }
  const { data: tpl, error: tplErr } = await supabase
    .from('analysis_templates')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (tplErr || !tpl) return { status: 404, error: 'Template not found' }

  const { error } = await supabase
    .from('template_favorites')
    .delete()
    .eq('user_id', user.id)
    .eq('template_id', tpl.id)
  if (error) return { status: 400, error: error.message }
  return { status: 200, body: { success: true, favorited: false } }
}

export async function listFavoriteIds(supabase, user) {
  if (!user) return { status: 401, error: 'Unauthorized' }
  const { data, error } = await supabase
    .from('template_favorites')
    .select('template_id')
    .eq('user_id', user.id)
  if (error) return { status: 400, error: error.message }
  return { status: 200, body: { success: true, favoriteIds: (data || []).map((r) => r.template_id) } }
}

// Distinct template ids, most recently executed first (rows must be pre-sorted desc).
export function distinctRecentIds(rows, limit = 5) {
  const seen = new Set()
  for (const r of rows || []) {
    if (r?.template_id && !seen.has(r.template_id)) seen.add(r.template_id)
    if (seen.size >= limit) break
  }
  return [...seen]
}

// Templates the caller ran most recently across all of their activities.
export async function listRecentTemplateIds(supabase, user, limit = 5) {
  if (!user) return { status: 401, error: 'Unauthorized' }
  const { data, error } = await supabase
    .from('template_executions')
    .select('template_id, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) return { status: 400, error: error.message }
  return { status: 200, body: { success: true, recentIds: distinctRecentIds(data, limit) } }
}

// Groups templates by category (alphabetical, "Uncategorized" last); order inside is kept.
export function groupByCategory(templates) {
  const map = new Map()
  for (const t of templates) {
    const key = t.category || 'Uncategorized'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === 'Uncategorized') - (b === 'Uncategorized') || a.localeCompare(b))
    .map(([category, items]) => ({ category, items }))
}

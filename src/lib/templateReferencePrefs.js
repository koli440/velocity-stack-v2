// Remembered reference choice per user + template (issue #283), stored in public.template_reference_prefs
// with a localStorage copy, so the choice survives even when the table is unreachable.

import { REFERENCE_MODES } from './templateComparison.js'

const LS_PREFIX = 'vs.templateReference.'

export function normalizePref(pref) {
  const mode = REFERENCE_MODES.includes(pref?.mode) ? pref.mode : 'previous'
  return { mode, customId: mode === 'custom' && typeof pref?.customId === 'string' && pref.customId ? pref.customId : null }
}

const storageKey = (userId, scopeId, slug) => `${LS_PREFIX}${userId}.${scopeId || userId}.${slug}`

function readLocal(storage, key) {
  try {
    const raw = storage?.getItem(key)
    return raw ? normalizePref(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeLocal(storage, key, pref) {
  try {
    storage?.setItem(key, JSON.stringify(pref))
  } catch {
    // storage unavailable or full: the server copy still applies
  }
}

/** Server copy wins, then the local copy, then "previous run". */
export async function loadReferencePref(supabase, { userId, scopeId = null, slug, storage = globalThis.localStorage }) {
  if (!userId || !slug) return normalizePref(null)
  const scope = scopeId || userId
  try {
    const { data, error } = await supabase
      .from('template_reference_prefs')
      .select('mode, custom_execution_id')
      .eq('user_id', userId)
      .eq('scope_id', scope)
      .eq('template_slug', slug)
      .maybeSingle()
    if (!error && data) return normalizePref({ mode: data.mode, customId: data.custom_execution_id })
  } catch {
    // fall through to the local copy
  }
  return readLocal(storage, storageKey(userId, scope, slug)) || normalizePref(null)
}

export async function saveReferencePref(supabase, { userId, scopeId = null, slug, pref, storage = globalThis.localStorage }) {
  if (!userId || !slug) return false
  const scope = scopeId || userId
  const clean = normalizePref(pref)
  writeLocal(storage, storageKey(userId, scope, slug), clean)
  try {
    const { error } = await supabase.from('template_reference_prefs').upsert(
      { user_id: userId, scope_id: scope, template_slug: slug, mode: clean.mode, custom_execution_id: clean.customId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,scope_id,template_slug' }
    )
    return !error
  } catch {
    return false
  }
}

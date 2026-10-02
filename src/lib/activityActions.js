// src/lib/activityActions.js
//
// Permanent activity deletion (issue #18). Deleting an activity row cascades in the database
// to its `activity_curves` and `template_executions` rows (ON DELETE CASCADE, see
// supabase/migrations/20260924000000_init_schema.sql and 20260925000000_activity_analyzer.sql),
// so this helper only needs to also remove the archived raw .fit file from Storage (if any)
// before deleting the `activities` row itself.

const RAW_ACTIVITY_BUCKET = 'raw-activity-files'

/**
 * Permanently deletes an activity and its archived raw file.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client - Supabase client to operate with.
 * @param {{ id: string, raw_file_url?: string|null }} activity - Activity to delete.
 * @returns {Promise<{ error: Error|null }>}
 */
export async function deleteActivity(client, activity) {
  if (!activity?.id) {
    return { error: new Error('Missing activity id') }
  }

  if (activity.raw_file_url) {
    const { error: storageError } = await client.storage
      .from(RAW_ACTIVITY_BUCKET)
      .remove([activity.raw_file_url])

    // Non-fatal: an orphaned raw file shouldn't block deleting the activity record itself.
    if (storageError) {
      console.warn('Failed to remove archived .fit file from storage:', storageError.message)
    }
  }

  const { error } = await client.from('activities').delete().eq('id', activity.id)

  return { error: error || null }
}

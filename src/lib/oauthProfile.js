// Mirror of the profile mapping in public.handle_new_user (migration 20270101000000_oauth_signup_profile.sql):
// which profile fields a new account gets from auth signup metadata. Email signup sends first_name/last_name;
// Google sends given_name/family_name/full_name/name/picture. Keep both in sync.

const clean = (v) => (typeof v === 'string' ? v.trim() : '')

/** @returns {{ first_name: string|null, last_name: string|null, nickname: string|null }} */
export function profileFromAuthMetadata(meta, email) {
  const m = meta && typeof meta === 'object' ? meta : {}
  let first = clean(m.first_name) || clean(m.given_name)
  let last = clean(m.last_name) || clean(m.family_name)
  if (!first && !last) {
    const full = clean(m.full_name) || clean(m.name)
    if (full) {
      const parts = full.split(/\s+/)
      first = parts[0]
      last = parts.slice(1).join(' ')
    }
  }
  let nickname = clean(m.nickname)
  if (!nickname && !first && !last) nickname = clean(String(email || '').split('@')[0]).slice(0, 40)
  return { first_name: first || null, last_name: last || null, nickname: nickname || null }
}

/** Sign-in methods of a user, e.g. ['email', 'google']. */
export function signInMethods(user) {
  const set = new Set()
  for (const i of user?.identities || []) if (i?.provider) set.add(i.provider)
  for (const p of user?.app_metadata?.providers || []) set.add(p)
  if (!set.size && user?.app_metadata?.provider) set.add(user.app_metadata.provider)
  return [...set]
}

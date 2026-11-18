// Shared helpers for the split settings pages. Each page saves only its own profile columns,
// so a stale value on one page can never overwrite another page's fields.
import { toGearField, parseGear } from './gear.js'
import { effectiveRideType, DEFAULT_RIDE_TYPE } from './rideType.js'

export const SETTINGS_PAGES = Object.freeze([
  { key: 'profile', label: 'Profile', href: '/settings' },
  { key: 'preferences', label: 'Preferences', href: '/settings/preferences' },
  { key: 'gear', label: 'Gear and defaults', href: '/settings/gear' },
  { key: 'physiology', label: 'Physiology', href: '/settings/physiology' },
  { key: 'connections', label: 'Connections', href: '/connections' },
  { key: 'privacy', label: 'Privacy', href: '/settings/privacy' },
  { key: 'coaching', label: 'Coaching', href: '/settings/coaching' },
])

/** Breadcrumb items for a settings page, e.g. Settings > Preferences. */
export function settingsCrumbs(pageKey) {
  const page = SETTINGS_PAGES.find((p) => p.key === pageKey)
  return [{ label: 'Settings', href: '/settings' }, { label: page ? page.label : 'Profile' }]
}

const str = (v) => (v == null ? '' : String(v))

/** Editable form values for every settings page, derived from a profiles row (null row gives defaults). */
export function formFromRow(row) {
  const r = row || {}
  return {
    firstName: str(r.first_name),
    lastName: str(r.last_name),
    nickname: str(r.nickname),
    birthYear: r.birth_year ? String(r.birth_year) : '',
    homeTrackId: r.home_track_id || '',
    defaultChainring: toGearField(r.default_chainring),
    defaultCog: toGearField(r.default_cog),
    crankLength: r.crank_length_mm ? String(r.crank_length_mm) : '165.0',
    defaultRideType: effectiveRideType(r.default_ride_type) || DEFAULT_RIDE_TYPE,
    discoverableByEmail: r.discoverable_by_email !== false,
    emailNotifications: r.email_notifications !== false,
    reactionsEnabled: r.reactions_enabled !== false,
    reactionNotifications: r.reaction_notifications !== false,
    includeGym: r.include_gym_in_fitness !== false,
    avatarUrl: r.avatar_url || null,
  }
}

/**
 * Columns to save for one settings page: { updates } or { error }.
 * section: 'profile' | 'preferences' | 'gear'. Only that section's columns are returned.
 */
export function buildProfileUpdate(section, f) {
  if (section === 'profile') {
    return {
      updates: {
        first_name: f.firstName.trim() || null,
        last_name: f.lastName.trim() || null,
        nickname: f.nickname.trim() || null,
        birth_year: /^(19|20)\d{2}$/.test(f.birthYear.trim()) ? Number(f.birthYear.trim()) : null,
      },
    }
  }
  if (section === 'preferences') {
    return {
      updates: {
        discoverable_by_email: f.discoverableByEmail,
        email_notifications: f.emailNotifications,
        reactions_enabled: f.reactionsEnabled,
        reaction_notifications: f.reactionNotifications,
        include_gym_in_fitness: f.includeGym,
      },
    }
  }
  if (section === 'gear') {
    const gear = parseGear(f.defaultChainring, f.defaultCog)
    if (!gear.valid) return { error: gear.error }
    const crank = parseFloat(f.crankLength)
    return {
      updates: {
        home_track_id: f.homeTrackId || null,
        default_chainring: gear.chainring,
        default_cog: gear.cog,
        crank_length_mm: Number.isFinite(crank) && crank > 0 ? crank : 165.0,
        default_ride_type: f.defaultRideType,
      },
    }
  }
  return { error: `Unknown settings section: ${section}` }
}

const LEGACY_HASHES = {
  '#physiology': '/settings/physiology',
  '#coaching': '/settings/coaching',
  '#onboarding': '/settings/coaching',
}

/** Old /settings#section links (emails, push notifications, bookmarks) -> new page path with the hash kept, or null. */
export function legacySettingsRedirect(hash) {
  const target = LEGACY_HASHES[hash]
  return target ? `${target}${hash}` : null
}

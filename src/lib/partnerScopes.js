// Client-safe constants of the partner OAuth provider (no node:crypto, usable in components).
export const PARTNER_SCOPES = Object.freeze(['activities:write', 'profile:read'])
export const SCOPE_LABELS = Object.freeze({
  'activities:write': 'Upload rides and workouts to your account',
  'profile:read': 'Read your FTP, weight and units',
})

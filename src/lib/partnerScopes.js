// Client-safe constants of the partner OAuth provider (no node:crypto, usable in components).
export const PARTNER_SCOPES = Object.freeze(['activities:write', 'profile:read', 'plans:read', 'plans:write', 'activities:read'])
export const SCOPE_LABELS = Object.freeze({
  'activities:write': 'Upload rides and workouts to your account',
  'profile:read': 'Read your FTP, weight and units',
  'plans:read': 'Read the planned workouts in your calendar (and your training plan)',
  'plans:write': 'Plan, edit, move, skip and delete workouts in your calendar',
  'activities:read': 'Read your activities, fitness and analysis results, and run your analysis templates on them',
})

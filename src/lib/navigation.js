// Sidebar menu definition (icon = key in lib/iconSet). Order matters: it is the order rendered in the Sidebar.
export const NAV_ITEMS = [
  { key: 'home', label: 'Rider Telemetry', icon: 'home', href: '/', exact: true },
  { key: 'calendar', label: 'Calendar', icon: 'calendar', href: '/calendar' },
  { key: 'pb-vault', label: 'Personal Best Vault', icon: 'trophy', href: '/pb-vault' },
  { key: 'gears', label: 'Gear Architect', icon: 'gears', href: '/gears' },
  { key: 'pursuit', label: 'Pursuit Strategist', icon: 'stopwatch', href: '/pursuit' },
  { key: 'aero-lab', label: 'Aero Lab', icon: 'flask', href: '/aero-lab' },
  { key: 'templates', label: 'Templates', icon: 'clipboard', href: '/templates' },
  { key: 'velodromes', label: 'Velodromes', icon: 'velodrome', href: '/velodromes' },
  { key: 'about', label: 'About', icon: 'book', href: '/about' },
  { key: 'feedback', label: 'Feedback', icon: 'bulb', href: '/feedback' },
  { key: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
]

export function isNavItemActive(item, pathname) {
  if (!item.href) return false
  return item.exact ? pathname === item.href : pathname.startsWith(item.href)
}

// Window events used to let the top banner and the dashboard talk to each other.
export const OPEN_ADD_SESSION_EVENT = 'velocity:open-add-session'
export const ACTIVITIES_CHANGED_EVENT = 'velocity:activities-changed'
export const PROFILE_UPDATED_EVENT = 'velocity:profile-updated'

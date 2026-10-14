// Sidebar menu definition. Order matters: it is the order rendered in the Sidebar.
export const NAV_ITEMS = [
  { key: 'home', label: 'Rider Telemetry', icon: '🏠', href: '/', exact: true },
  { key: 'pb-vault', label: 'Personal Best Vault', icon: '🏆', href: '/pb-vault' },
  { key: 'gears', label: 'Gear Architect', icon: '🔧', href: '/gears' },
  { key: 'pursuit', label: 'Pursuit Strategist', icon: '⏱️', href: '/pursuit' },
  { key: 'aero-lab', label: 'Aero Lab', icon: '🧪', href: '/aero-lab' },
  { key: 'templates', label: 'Templates', icon: '📋', href: '/templates' },
  { key: 'velodromes', label: 'Velodromes', icon: '🏟️', href: '/velodromes' },
  { key: 'about', label: 'About', icon: '📖', href: '/about' },
  { key: 'feedback', label: 'Feedback', icon: '💡', href: '/feedback' },
  { key: 'settings', label: 'Settings', icon: '⚙️', action: 'settings' },
]

export function isNavItemActive(item, pathname) {
  if (!item.href) return false
  return item.exact ? pathname === item.href : pathname.startsWith(item.href)
}

// Window events used to let the top banner and the dashboard talk to each other.
export const OPEN_ADD_SESSION_EVENT = 'velocity:open-add-session'
export const ACTIVITIES_CHANGED_EVENT = 'velocity:activities-changed'

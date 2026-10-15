// Legacy entry point kept for existing imports; icons now come from the unified set (lib/iconSet).
import BaseIcon from './Icon'

const ALIASES = { track: 'velodrome', ride: 'bike', power: 'bolt', gear: 'settings', pin: 'pin' }

export default function Icon({ name, size = 16, className = '', title }) {
  return <BaseIcon name={ALIASES[name] || name} size={size} className={className} title={title} />
}

export const BADGE_ICONS = {
  PB: 'trophy',
  POWER_RECORD: 'power',
  SPEED_RECORD: 'speed',
  IMPROVEMENT: 'trend',
  HARD_SESSION: 'flame',
  LONG_RIDE: 'distance',
  BIG_CLIMB: 'mountain',
  HIGH_POWER: 'power',
  TOP_SPEED: 'speed',
}

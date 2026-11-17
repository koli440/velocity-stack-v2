import Icon from './Icon'
import { FOUNDING_LABEL } from '../lib/coachPlans'

export default function FoundingBadge({ founding }) {
  if (!founding) return null
  return (
    <span data-testid="founding-badge" className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold border bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900 dark:text-amber-100 dark:border-amber-700">
      <Icon name="star" />{FOUNDING_LABEL}
    </span>
  )
}

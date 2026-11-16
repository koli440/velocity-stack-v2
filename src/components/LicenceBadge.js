import Icon from './Icon'
import { licenceChip } from '../lib/coachLicence'

// Public licence chip: green when verified by an admin, grey when self-declared.
export default function LicenceBadge({ licence }) {
  const chip = licenceChip(licence)
  if (!chip) return null
  return (
    <span data-testid="licence-badge" className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold border ${chip.verified ? 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900 dark:text-emerald-100 dark:border-emerald-700' : 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600'}`}>
      {chip.verified && <Icon name="check" />}{chip.label}
    </span>
  )
}

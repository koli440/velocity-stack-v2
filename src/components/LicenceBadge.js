import { licenceChip } from '../lib/coachLicence'

// Public licence chip: green when verified by an admin, grey when self-declared.
export default function LicenceBadge({ licence }) {
  const chip = licenceChip(licence)
  if (!chip) return null
  return (
    <span data-testid="licence-badge" className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${chip.verified ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
      {chip.verified ? '✓ ' : ''}{chip.label}
    </span>
  )
}

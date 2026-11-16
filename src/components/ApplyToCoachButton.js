import Link from 'next/link'

// Shown on the public card. The apply page re-checks everything server-side (coach flag, blocks, capacity).
export default function ApplyToCoachButton({ slug }) {
  return (
    <Link href={`/c/${slug}/apply`} data-testid="apply-to-coach" className="inline-block px-4 py-2 rounded-lg text-sm font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900">
      Apply to this coach
    </Link>
  )
}

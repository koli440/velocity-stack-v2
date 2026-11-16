import Link from 'next/link'

// Shown on the public card. The apply page re-checks everything server-side (coach flag, blocks, capacity).
export default function ApplyToCoachButton({ slug }) {
  return (
    <Link href={`/c/${slug}/apply`} data-testid="apply-to-coach" className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-xl text-sm font-bold bg-orange-500 text-white hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2">
      Apply to this coach
    </Link>
  )
}

import Link from 'next/link'
import { chatPath } from '../lib/coachChat'

// Opens /chat/<relationshipId>; the thread is created by the first message sent from there.
export default function MessageButton({ relationshipId, label = 'Message', className = '' }) {
  if (!relationshipId) return null
  return (
    <Link
      href={chatPath(relationshipId)}
      data-testid="message-button"
      className={`inline-flex items-center justify-center min-h-[36px] rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold px-3 ${className}`}
    >
      {label}
    </Link>
  )
}

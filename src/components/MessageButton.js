import Link from 'next/link'
import Icon from './Icon'
import { chatPath } from '../lib/coachChat'

// Opens /chat/<relationshipId>; the thread is created by the first message sent from there.
export default function MessageButton({ relationshipId, label = 'Message', className = '' }) {
  if (!relationshipId) return null
  return (
    <Link
      href={chatPath(relationshipId)}
      data-testid="message-button"
      className={`inline-flex items-center justify-center min-h-[44px] lg:min-h-[40px] gap-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold px-4 ${className}`}
    >
      <Icon name="chat" />
      {label}
    </Link>
  )
}

'use client'

import ChatThread from '../../../../components/ChatThread'
import { useAthlete } from '../../../../components/AthleteContext'
import { adminCard } from '../../../../components/admin/AdminUi'

// Messages with this athlete, inside the athlete context (the thread id is the coaching relationship id).
export default function AthleteChatPage() {
  const { riderId, athlete, relationshipId } = useAthlete()
  if (!riderId) return null
  if (!relationshipId) {
    return <p className={`${adminCard} max-w-2xl mx-auto text-sm text-slate-700 dark:text-slate-200`} data-testid="athlete-chat-unavailable">Chat opens when a coaching relationship with this athlete is active.</p>
  }
  return <ChatThread id={relationshipId} riderId={riderId} athleteName={athlete?.display_name} />
}

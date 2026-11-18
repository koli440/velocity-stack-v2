'use client'

import { useParams } from 'next/navigation'
import ChatThread from '../../../components/ChatThread'

export default function ChatThreadPage() {
  const { id } = useParams()
  return <ChatThread id={id} />
}

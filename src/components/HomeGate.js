'use client'

import { useAuthState } from './AuthState'

// Signed-out visitors and crawlers (initial HTML) get the landing section; riders get the dashboard.
export default function HomeGate({ landing, children }) {
  const { checking, user } = useAuthState()
  return checking || !user ? landing : children
}

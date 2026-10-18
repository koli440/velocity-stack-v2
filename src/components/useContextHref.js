'use client'

import { usePathname } from 'next/navigation'
import { contextualHref, parseCoachPath } from '../lib/coachContext'

// Returns a mapper that keeps in-page links inside the athlete context (/coach/<id>/...).
export default function useContextHref() {
  const { riderId } = parseCoachPath(usePathname())
  return (href) => contextualHref(href, riderId)
}

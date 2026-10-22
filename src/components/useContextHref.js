'use client'

import { usePathname } from 'next/navigation'
import { contextualHref, parseCoachPath } from '../lib/coachContext'
import { currentReturnTo, withReturnTo } from '../lib/returnTo'

// Returns a mapper that keeps in-page links inside the athlete context (/coach/<id>/...) and lets
// activity links return to this page.
export default function useContextHref() {
  const pathname = usePathname()
  const { riderId } = parseCoachPath(pathname)
  return (href) => withReturnTo(contextualHref(href, riderId), currentReturnTo(pathname))
}

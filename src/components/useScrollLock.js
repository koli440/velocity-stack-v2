'use client'

import { useEffect } from 'react'
import { acquireScrollLock } from './scrollLockCore'

// Locks page scroll while `active` (default true) and the component is mounted.
// Ref-counted, so overlapping modals restore the original overflow only once all close.
export default function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined
    return acquireScrollLock(document.body)
  }, [active])
}

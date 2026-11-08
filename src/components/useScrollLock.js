'use client'

import { useEffect } from 'react'

// Locks page scroll while a modal is mounted; restores the previous overflow on unmount.
export default function useScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
}

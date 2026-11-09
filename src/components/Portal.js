'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import useScrollLock from './useScrollLock'

function Locked({ children }) {
  useScrollLock()
  return children
}

// Renders children into document.body so fixed overlays are positioned against the
// viewport, not an ancestor with backdrop-filter/transform (e.g. glass cards).
// `lockScroll` also locks page scroll for as long as the portal content is mounted.
export default function Portal({ children, lockScroll = false }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(lockScroll ? <Locked>{children}</Locked> : children, document.body)
}

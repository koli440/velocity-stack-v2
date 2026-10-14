'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Renders children into document.body so fixed overlays are positioned against the
// viewport, not an ancestor with backdrop-filter/transform (e.g. glass cards).
export default function Portal({ children }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? createPortal(children, document.body) : null
}

'use client'

import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Modal accessibility: focus moves into the dialog, Tab is trapped, Escape closes, page scroll is locked and
// focus returns to the opener on close. Attach the returned ref to the element with role="dialog".
export default function useModalA11y(open, onClose) {
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement
    const dialog = dialogRef.current
    const first = dialog?.querySelector('[data-autofocus]') || dialog
    first?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const els = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE))
      if (els.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = els[0]
      const lastEl = els[els.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === firstEl || active === dialogRef.current)) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  }, [open])

  return dialogRef
}

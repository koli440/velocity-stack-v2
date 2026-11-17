'use client'

import { useCallback, useEffect, useRef } from 'react'

// Textarea that grows with its content up to maxPx, then scrolls (touch browsers have no resize handle).
export default function AutoTextarea({ value, className = '', maxPx = 360, onInput, ...rest }) {
  const ref = useRef(null)
  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, maxPx)}px`
  }, [maxPx])
  useEffect(fit, [fit, value])
  return (
    <textarea
      ref={ref}
      value={value}
      onInput={(e) => { fit(); onInput?.(e) }}
      className={`${className} resize-y overflow-y-auto break-words whitespace-pre-wrap`}
      style={{ maxHeight: maxPx }}
      {...rest}
    />
  )
}

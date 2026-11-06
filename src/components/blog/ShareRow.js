'use client'

import { useEffect, useId, useRef, useState } from 'react'

const itemCls = 'flex w-full items-center px-3 py-2 text-left text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 focus:bg-slate-100 dark:focus:bg-white/5 focus:outline-none'

// Universal share button: native share sheet when available, otherwise a small popover of plain share links
// (no scripts or trackers). Rendered at the top and bottom of a post; `placement` opens the popover up or down.
export default function ShareRow({ links, url, title, placement = 'top' }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const root = useRef(null)
  const button = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (root.current && !root.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    root.current?.querySelector('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = async () => {
    if (!open && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url })
      } catch {
        // dismissed by the user
      }
      return
    }
    setOpen((o) => !o)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link', url)
    }
    setOpen(false)
  }

  const onMenuKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...root.current.querySelectorAll('[role="menuitem"]')]
    const i = items.indexOf(document.activeElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  return (
    <div ref={root} className="relative inline-block" data-testid="share-control">
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-label="Share this post"
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 dark:border-surface-darkBorder px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V3" />
          <path d="m7 8 5-5 5 5" />
          <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>
        {copied ? 'Link copied' : 'Share'}
      </button>
      <span role="status" className="sr-only">{copied ? 'Link copied' : ''}</span>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Share this post"
          onKeyDown={onMenuKey}
          className={`absolute right-0 z-30 w-44 overflow-hidden rounded-xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard shadow-lg ${placement === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          <button type="button" role="menuitem" onClick={copy} className={itemCls}>
            Copy link
          </button>
          {links.map(([name, href]) => (
            <a key={name} role="menuitem" href={href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={itemCls}>
              {name}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

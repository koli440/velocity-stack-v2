'use client'

import { useState } from 'react'

const linkCls = 'px-3 py-1.5 rounded-lg border border-slate-300 dark:border-surface-darkBorder text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5'

// Plain share links (no scripts or trackers) plus a copy-link button.
export default function ShareRow({ links, url }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link', url)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Share this post">
      <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mr-1">Share</span>
      {links.map(([name, href]) => (
        <a key={name} href={href} target="_blank" rel="noopener noreferrer" className={linkCls}>
          {name}
        </a>
      ))}
      <button type="button" onClick={copy} className={linkCls}>
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      <span role="status" className="sr-only">{copied ? 'Link copied' : ''}</span>
    </div>
  )
}

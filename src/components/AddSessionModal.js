'use client'

import { useEffect, useRef, useState } from 'react'
import Portal from './Portal'
import { useRouter } from 'next/navigation'
import { ACTIVITIES_CHANGED_EVENT } from '../lib/navigation'
import FitUploader from './FitUploader'
import IntervalsSyncModal from './IntervalsSyncModal'
import BulkImportModal from './BulkImportModal'
import Icon from './Icon'

const CHOICES = [
  { key: 'sync', icon: 'refresh', label: 'Sync Intervals.icu', hint: 'Pick recent rides from your Intervals.icu account' },
  { key: 'import', icon: 'package', label: 'Import History', hint: 'Bulk-import a .zip or .fit archive' },
  { key: 'fit', icon: 'plus', label: 'Add .fit / workout session', hint: 'Upload a single .fit file or log a workout' },
]

// Top-banner "Add / Sync" flow: asks what to do, then shows the chosen existing flow.
function AddSessionModalInner({ isOpen, onClose, user, tracks = [] }) {
  const router = useRouter()
  const [flow, setFlow] = useState(null)
  const firstChoice = useRef(null)

  useEffect(() => {
    if (isOpen) setFlow(null)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || flow) return
    firstChoice.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, flow, onClose])

  if (!isOpen) return null

  const notifyChanged = () => window.dispatchEvent(new Event(ACTIVITIES_CHANGED_EVENT))
  const afterImport = (newId) => {
    onClose()
    if (newId) router.push(`/activities/${newId}`)
    else notifyChanged()
  }

  if (flow === 'sync') {
    return (
      <IntervalsSyncModal
        isOpen
        onClose={onClose}
        currentUser={user}
        tracks={tracks}
        onImportSuccess={afterImport}
      />
    )
  }

  if (flow === 'import') {
    return (
      <BulkImportModal
        isOpen
        onClose={onClose}
        currentUser={user}
        tracks={tracks}
        onImportComplete={notifyChanged}
      />
    )
  }

  if (flow === 'fit') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
        <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <FitUploader tracks={tracks} currentUser={user} onClose={onClose} onSaved={afterImport} />
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-session-title"
        onClick={(e) => e.stopPropagation()}
        className="glass-modal w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-5 shadow-xl space-y-3"
      >
        <div className="flex items-center justify-between">
          <h2 id="add-session-title" className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">
            What would you like to do?
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1">
            <Icon name="close" size={18} />
          </button>
        </div>
        {CHOICES.map((c, i) => (
          <button
            key={c.key}
            type="button"
            ref={i === 0 ? firstChoice : null}
            onClick={() => setFlow(c.key)}
            className="w-full text-left flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
          >
            <span className="text-xl text-emerald-500 dark:text-brand-neon"><Icon name={c.icon} size={22} /></span>
            <span>
              <span className="block text-xs font-bold text-slate-900 dark:text-white">{c.label}</span>
              <span className="block text-[11px] text-slate-500">{c.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function AddSessionModal(props) {
  return (
    <Portal>
      <AddSessionModalInner {...props} />
    </Portal>
  )
}

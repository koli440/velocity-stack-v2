'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getAuthHeader } from '../../lib/supabase'

export default function ReportBugPage() {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    severity: 'medium',
  })
  const [status, setStatus] = useState({ type: null, message: '' })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setStatus({ type: null, message: '' })

    try {
      const response = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeader()),
        },
        body: JSON.stringify(formData),
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Unable to submit bug report')
      }

      setFormData({ title: '', description: '', severity: 'medium' })
      setStatus({ type: 'success', message: 'Thanks — your bug report was submitted.' })
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href="/" className="text-xs font-bold text-emerald-600 dark:text-brand-neon hover:underline">
          ← Back to cockpit
        </Link>
        <h1 className="mt-4 text-2xl font-black text-slate-900 dark:text-white">Report a Bug</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Tell us what went wrong so we can improve VelocityStack.
        </p>
      </div>

      {status.message && (
        <div className={`rounded-xl border p-4 text-sm ${
          status.type === 'success'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
            : 'border-rose-500/30 bg-rose-500/10 text-rose-500'
        }`}>
          {status.message}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-surface-darkBorder dark:bg-surface-darkCard"
      >
        <div>
          <label htmlFor="bug-title" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
            Short summary
          </label>
          <input
            id="bug-title"
            required
            maxLength={200}
            value={formData.title}
            onChange={(event) => setFormData({ ...formData, title: event.target.value })}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>

        <div>
          <label htmlFor="bug-description" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
            What happened?
          </label>
          <textarea
            id="bug-description"
            required
            maxLength={5000}
            rows={7}
            value={formData.description}
            onChange={(event) => setFormData({ ...formData, description: event.target.value })}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>

        <div>
          <label htmlFor="bug-severity" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
            Severity
          </label>
          <select
            id="bug-severity"
            value={formData.severity}
            onChange={(event) => setFormData({ ...formData, severity: event.target.value })}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-slate-900 py-3.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
        >
          {loading ? 'Submitting...' : 'Submit Bug Report'}
        </button>
      </form>
    </section>
  )
}

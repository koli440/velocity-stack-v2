'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { getAuthHeader } from '../../lib/supabase'

const MODULE_LABELS = {
  aero_lab: 'Aero Lab',
  pursuit_strategist: 'Pursuit Strategist',
  gear_architect: 'Gear Architect',
  pb_vault: 'PB Vault',
  account_login: 'Account/Login',
  other: 'Other',
}

const CATEGORY_LABELS = {
  bug: 'Report a Bug 🐛',
  feature_request: 'Feature Request ✨',
  general: 'General Feedback 💬',
}

const STATUS_COLUMNS = [
  { key: 'new', label: '📥 New' },
  { key: 'in_progress', label: '⚙️ In-Progress' },
  { key: 'done', label: '✅ Done' },
]

export default function FeedbackPage() {
  const [formData, setFormData] = useState({
    category: 'general',
    module: 'other',
    description: '',
  })
  const [status, setStatus] = useState({ type: null, message: '' })
  const [loading, setLoading] = useState(false)
  const [roadmap, setRoadmap] = useState([])
  const [roadmapLoading, setRoadmapLoading] = useState(true)

  const loadRoadmap = useCallback(async () => {
    setRoadmapLoading(true)
    try {
      const response = await fetch('/api/feedback', {
        headers: { ...(await getAuthHeader()) },
      })
      const result = await response.json()
      if (response.ok) {
        setRoadmap(result.feedback || [])
      }
    } catch {
      // Roadmap is a bonus view; silently ignore load failures.
    } finally {
      setRoadmapLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRoadmap()
  }, [loadRoadmap])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setStatus({ type: null, message: '' })

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeader()),
        },
        body: JSON.stringify(formData),
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Unable to submit feedback')
      }

      setFormData({ category: 'general', module: 'other', description: '' })
      setStatus({ type: 'success', message: "Thank you! Your feedback has been recorded. We'll review it soon! 🚲" })
      loadRoadmap()
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="max-w-4xl mx-auto space-y-8">
      <div>
        <Link href="/" className="text-xs font-bold text-emerald-600 dark:text-brand-neon hover:underline">
          ← Back to cockpit
        </Link>
        <h1 className="mt-4 text-2xl font-black text-slate-900 dark:text-white">
          💡 Feedback & Feature Requests
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Help us build the ultimate track cycling tool! Whether you found a bug 🐛 or have a
          brilliant idea for a new feature ✨, we want to hear from you. Looking to report a bug
          specifically?{' '}
          <Link href="/report-bug" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">
            Use the dedicated bug form
          </Link>
          .
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label htmlFor="feedback-category" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
              Category
            </label>
            <select
              id="feedback-category"
              value={formData.category}
              onChange={(event) => setFormData({ ...formData, category: event.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            >
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="feedback-module" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
              Which part of the app?
            </label>
            <select
              id="feedback-module"
              value={formData.module}
              onChange={(event) => setFormData({ ...formData, module: event.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            >
              {Object.entries(MODULE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="feedback-description" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
            Details
          </label>
          <textarea
            id="feedback-description"
            required
            maxLength={5000}
            rows={6}
            placeholder="Please describe the issue or your idea in detail..."
            value={formData.description}
            onChange={(event) => setFormData({ ...formData, description: event.target.value })}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-slate-900 py-3.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
        >
          {loading ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </form>

      <div className="border-t border-slate-200 dark:border-surface-darkBorder pt-6">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">🚀 Community Roadmap</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          See what others have suggested and what&apos;s currently in development.
        </p>

        {roadmapLoading ? (
          <p className="mt-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Loading roadmap...</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {STATUS_COLUMNS.map(({ key, label }) => {
              const items = roadmap.filter((item) => item.status === key)
              return (
                <div key={key} className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</h3>
                  {items.length === 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500">Nothing here yet.</p>
                  )}
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm dark:border-surface-darkBorder dark:bg-surface-darkCard"
                    >
                      <p className="font-bold text-slate-900 dark:text-white">
                        {CATEGORY_LABELS[item.category] || item.category} · {MODULE_LABELS[item.module] || item.module}
                      </p>
                      <p className="mt-1 text-slate-500 dark:text-slate-400">{item.description}</p>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

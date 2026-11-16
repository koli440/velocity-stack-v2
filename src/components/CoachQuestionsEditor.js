'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { COACH_QUESTION_MAX, MAX_COACH_QUESTIONS, fetchMyQuestions, saveQuestions } from '../lib/coachOnboarding'

// Up to 5 optional questions that applicants answer in the onboarding form.
export default function CoachQuestionsEditor() {
  const [qs, setQs] = useState(null)
  const [msg, setMsg] = useState(null)
  useEffect(() => { fetchMyQuestions(supabase).then(({ questions }) => setQs(questions)) }, [])
  if (!qs) return null
  const save = async () => {
    const { error } = await saveQuestions(supabase, qs)
    setMsg(error ? { error: true, text: 'Could not save the questions.' } : { text: 'Saved' })
  }
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="coach-questions">
      <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Questions for applicants</h2>
      <p className="text-xs text-slate-500">Optional, up to {MAX_COACH_QUESTIONS}. Applicants answer them when they apply to you.</p>
      {qs.map((q, i) => (
        <div key={i} className="flex gap-2">
          <input className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" maxLength={COACH_QUESTION_MAX} value={q} onChange={(e) => setQs(qs.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="text-xs underline text-red-600" onClick={() => setQs(qs.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="flex gap-3 items-center">
        {qs.length < MAX_COACH_QUESTIONS && <button type="button" className="text-sm font-bold underline" onClick={() => setQs([...qs, ''])}>Add question</button>}
        <button type="button" className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900" onClick={save}>Save questions</button>
        {msg && <span className={`text-xs font-bold ${msg.error ? 'text-rose-600' : 'text-emerald-500'}`}>{msg.text}</span>}
      </div>
    </section>
  )
}

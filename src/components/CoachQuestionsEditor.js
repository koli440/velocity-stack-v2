'use client'

import { useEffect, useState } from 'react'
import { adminCard, adminInput, adminMuted, adminBtn } from './admin/AdminUi'
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
    <section className={`${adminCard} space-y-3`} data-testid="coach-questions">
      <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Questions for applicants</h2>
      <p className={`text-sm ${adminMuted}`}>Optional, up to {MAX_COACH_QUESTIONS}. Applicants answer them when they apply to you.</p>
      {qs.map((q, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input className={adminInput} maxLength={COACH_QUESTION_MAX} value={q} onChange={(e) => setQs(qs.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className={adminBtn.danger} onClick={() => setQs(qs.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 items-center">
        {qs.length < MAX_COACH_QUESTIONS && <button type="button" className={adminBtn.secondary} onClick={() => setQs([...qs, ''])}>Add question</button>}
        <button type="button" className={adminBtn.primary} onClick={save}>Save questions</button>
        {msg && <span className={`text-xs font-bold ${msg.error ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{msg.text}</span>}
      </div>
    </section>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import WizardStep1Context from './WizardStep1Context'
import WizardStep2Setup from './WizardStep2Setup'
import WizardStep3Segmentation from './WizardStep3Segmentation'

export default function ActivityWizardModal({
  isOpen,
  onClose,
  activity,
  tracks = [],
  onCompleted,
}) {
  const [currentStep, setCurrentStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [activeTimeSeries, setActiveTimeSeries] = useState({})

  const [formData, setFormData] = useState({
    sport_type: 'track',
    session_mode: 'workout',
    discipline: 'f200',
    track_id: null,
    perceived_exertion: 7,
    chainring: 58,
    cog: 14,
    crank_length_mm: 165.0,
    bike_model: '',
    handlebar_setup: '',
    helmet: '',
    segmentation_mode: 'cadence',
    detected_efforts: [],
  })

  useEffect(() => {
    if (!activity || !isOpen) return

    setCurrentStep(1)
    setFormData({
      sport_type: activity.sport_type || 'track',
      session_mode: activity.session_mode || 'workout',
      discipline: activity.discipline || 'individual_pursuit',
      track_id: activity.track_id || null,
      perceived_exertion: activity.perceived_exertion || 7,
      chainring: activity.chainring || 58,
      cog: activity.cog || 14,
      crank_length_mm: activity.crank_length_mm || 165.0,
      bike_model: activity.bike_model || '',
      handlebar_setup: activity.handlebar_setup || '',
      helmet: activity.helmet || '',
      segmentation_mode: activity.segmentation_mode || 'cadence',
      detected_efforts: activity.detected_efforts || [],
    })

    // Načteme time_series přímo z DB pro případ, že v prop activity chybí
    const fetchTimeSeries = async () => {
      if (activity.time_series && Object.keys(activity.time_series).length > 0) {
        setActiveTimeSeries(activity.time_series)
      } else {
        const { data } = await supabase
          .from('activities')
          .select('time_series')
          .eq('id', activity.id)
          .single()

        if (data?.time_series) {
          setActiveTimeSeries(data.time_series)
        }
      }
    }

    fetchTimeSeries()
  }, [activity, isOpen])

  if (!isOpen || !activity) return null

  const handleSaveAndFinish = async () => {
    setSaving(true)

    const updates = {
      sport_type: formData.sport_type,
      session_mode: formData.session_mode,
      discipline: formData.discipline,
      track_id: formData.track_id || null,
      perceived_exertion: formData.perceived_exertion,
      chainring: parseInt(formData.chainring) || null,
      cog: parseInt(formData.cog) || null,
      crank_length_mm: parseFloat(formData.crank_length_mm) || 165.0,
      bike_model: formData.bike_model || null,
      handlebar_setup: formData.handlebar_setup || null,
      helmet: formData.helmet || null,
      detected_efforts: formData.detected_efforts || [],
      wizard_completed: true,
    }

    const { data, error } = await supabase
      .from('activities')
      .update(updates)
      .eq('id', activity.id)
      .select('*, tracks(*)')
      .single()

    setSaving(false)

    if (error) {
      alert('Chyba při ukládání: ' + error.message)
    } else {
      if (onCompleted) onCompleted(data || updates)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl max-h-[92vh] flex flex-col bg-white dark:bg-surface-darkCard rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-2xl overflow-hidden">
        
        {/* Hlavička & Krokovač */}
        <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold p-1 rounded-lg transition"
          >
            ✕
          </button>

          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase font-extrabold tracking-wider text-orange-500">
              Training Session Wizard
            </span>
            {activity.wizard_completed && (
              <span className="text-[10px] font-bold py-0.5 px-2 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                Již nastaveno (Editace)
              </span>
            )}
          </div>
          
          <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white truncate pr-8">
            {activity.title || 'Session Analysis'}
          </h2>

          <div className="grid grid-cols-3 gap-2 mt-4">
            <div
              onClick={() => setCurrentStep(1)}
              className={`cursor-pointer py-1.5 px-2 rounded-xl text-center border transition ${
                currentStep === 1
                  ? 'border-orange-500 bg-orange-500/10 text-orange-500'
                  : 'border-slate-200 dark:border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[9px] uppercase font-bold">Krok 1</div>
              <div className="text-xs font-black truncate">Sport & Kontext</div>
            </div>

            <div
              onClick={() => setCurrentStep(2)}
              className={`cursor-pointer py-1.5 px-2 rounded-xl text-center border transition ${
                currentStep === 2
                  ? 'border-orange-500 bg-orange-500/10 text-orange-500'
                  : 'border-slate-200 dark:border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[9px] uppercase font-bold">Krok 2</div>
              <div className="text-xs font-black truncate">Převody & Setup</div>
            </div>

            <div
              onClick={() => setCurrentStep(3)}
              className={`cursor-pointer py-1.5 px-2 rounded-xl text-center border transition ${
                currentStep === 3
                  ? 'border-orange-500 bg-orange-500/10 text-orange-500'
                  : 'border-slate-200 dark:border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[9px] uppercase font-bold">Krok 3</div>
              <div className="text-xs font-black truncate">Ostré úseky</div>
            </div>
          </div>
        </div>

        {/* Tělo aktivního kroku */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {currentStep === 1 && (
            <WizardStep1Context
              formData={formData}
              setFormData={setFormData}
              tracks={tracks}
            />
          )}

          {currentStep === 2 && (
            <WizardStep2Setup
              formData={formData}
              setFormData={setFormData}
            />
          )}

          {currentStep === 3 && (
            <WizardStep3Segmentation
              formData={formData}
              setFormData={setFormData}
              activity={{ ...activity, time_series: activeTimeSeries }}
            />
          )}
        </div>

        {/* Spodní lišta */}
        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/40">
          {currentStep > 1 ? (
            <button
              type="button"
              onClick={() => setCurrentStep((prev) => prev - 1)}
              className="py-2.5 px-4 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition"
            >
              ← Zpět
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            {currentStep < 3 ? (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => prev + 1)}
                className="py-2.5 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider transition shadow-xs"
              >
                Pokračovat →
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveAndFinish}
                className="py-2.5 px-6 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-xs uppercase tracking-wider transition shadow-md disabled:opacity-50"
              >
                {saving ? 'Ukládám...' : 'Dokončit & Vyhodnotit ✓'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Icon from './Icon'

export default function ThemeToggle({ currentUser = null }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleToggle = async () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)

    if (currentUser?.id) {
      await supabase
        .from('profiles')
        .update({ theme_preference: nextTheme, updated_at: new Date().toISOString() })
        .eq('id', currentUser.id)
    }
  }

  if (!mounted) return null

  return (
    <button
      onClick={handleToggle}
      className="p-2 sm:p-2.5 rounded-xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder text-slate-700 dark:text-slate-200 hover:opacity-80 transition flex items-center gap-2 text-xs font-semibold shadow-sm"
      title="Toggle Light / Dark mode"
      aria-label="Toggle Light / Dark mode"
    >
      {theme === 'dark' ? <><Icon name="sun" size={16} /><span className="hidden sm:inline">Light</span></> : <><Icon name="moon" size={16} /><span className="hidden sm:inline">Dark</span></>}
    </button>
  )
}
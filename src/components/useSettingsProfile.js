'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { PROFILE_UPDATED_EVENT } from '../lib/navigation'
import { buildProfileUpdate } from '../lib/settingsProfile'

/**
 * Session + profile row for a settings page, and a save helper that writes only that page's section.
 * Redirects to /login when signed out.
 */
export default function useSettingsProfile() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUser(session.user)
      else router.push('/login')
    })
  }, [router])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle().then(({ data }) => {
      if (cancelled) return
      setRow(data || null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [user?.id])

  const save = useCallback(async (section, form) => {
    if (!user?.id) return false
    const built = buildProfileUpdate(section, form)
    if (built.error) {
      alert(built.error)
      return false
    }
    setSaving(true)
    setSaved(false)
    const { error } = await supabase.from('profiles').upsert({ id: user.id, ...built.updates, updated_at: new Date().toISOString() })
    setSaving(false)
    if (error) {
      alert('Error while saving profile: ' + error.message)
      return false
    }
    window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT))
    setSaved(true)
    return true
  }, [user?.id])

  return { user, row, loading, saving, saved, setSaved, save }
}

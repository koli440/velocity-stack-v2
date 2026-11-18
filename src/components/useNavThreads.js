'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { fetchThreads } from '../lib/coachChat'

// One shared fetch of chat_threads_summary for the sidebar, the drawer and the bottom bar.
const FRESH_MS = 1500
const listeners = new Set()
let state = { threads: [], at: 0, inflight: null }

function publish(threads) {
  state = { threads, at: Date.now(), inflight: null }
  listeners.forEach((fn) => fn(threads))
}

function load() {
  if (state.inflight || Date.now() - state.at < FRESH_MS) return
  state = { ...state, inflight: fetchThreads(supabase).then(({ threads, error }) => publish(error ? [] : threads)) }
}

/** Conversation list of the signed-in user (empty when signed out); refreshed on every navigation. */
export default function useNavThreads(signedIn) {
  const pathname = usePathname()
  const [threads, setThreads] = useState(state.threads)

  useEffect(() => {
    listeners.add(setThreads)
    return () => listeners.delete(setThreads)
  }, [])

  useEffect(() => {
    if (!signedIn) {
      if (state.threads.length || state.at) {
        state = { threads: [], at: 0, inflight: null }
        listeners.forEach((fn) => fn([]))
      }
      return
    }
    load()
  }, [signedIn, pathname])

  return signedIn ? threads : []
}

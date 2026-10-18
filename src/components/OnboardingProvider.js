'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ACTIVITIES_CHANGED_EVENT } from '../lib/navigation'
import { OPEN_WELCOME_EVENT, evaluateChecklist, fetchOnboardingFacts } from '../lib/onboarding'
import { fetchOnboardingState, updateOnboardingState, shouldShowWelcome, unseenFor, markSeenPatch } from '../lib/onboardingState'
import WelcomeModal from './WelcomeModal'
import NewsModal from './NewsModal'

const OnboardingContext = createContext(null)

// Null-safe: outside the provider (auth pages, athlete context) everything is inert.
export function useOnboarding() {
  return (
    useContext(OnboardingContext) || {
      enabled: false,
      state: null,
      news: [],
      unreadNews: [],
      checklist: evaluateChecklist(null),
      openWelcome: () => {},
      markNewsSeen: async () => {},
      dismissChecklist: async () => {},
      restoreChecklist: async () => {},
    }
  )
}

// Own state of the SIGNED-IN user (userId comes from the session, never from the URL). `enabled=false`
// (coach/athlete context) skips all loading and modals so nothing is shown as the athlete's state.
export default function OnboardingProvider({ userId, enabled, children }) {
  const [state, setState] = useState(null)
  const [news, setNews] = useState([])
  const [facts, setFacts] = useState(null)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [newsOpen, setNewsOpen] = useState(false)
  const autoShown = useRef({ welcome: false, news: false })
  const active = !!userId && enabled

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    autoShown.current = { welcome: false, news: false }
    fetchOnboardingState(supabase, userId).then(({ state: s }) => !cancelled && s && setState(s))
    fetch('/api/news')
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d) => !cancelled && setNews(Array.isArray(d.entries) ? d.entries : []))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active, userId])

  const loadFacts = useCallback(async () => {
    if (!active) return
    try {
      setFacts(await fetchOnboardingFacts(supabase, userId))
    } catch {
      /* checklist just stays as it was */
    }
  }, [active, userId])

  useEffect(() => {
    loadFacts()
    window.addEventListener(ACTIVITIES_CHANGED_EVENT, loadFacts)
    window.addEventListener('focus', loadFacts)
    return () => {
      window.removeEventListener(ACTIVITIES_CHANGED_EVENT, loadFacts)
      window.removeEventListener('focus', loadFacts)
    }
  }, [loadFacts])

  const unreadNews = useMemo(() => unseenFor(state, news), [state, news])

  // On login: the welcome tour for a new account, otherwise the unseen news (never both at once).
  useEffect(() => {
    if (!active || !state) return
    if (shouldShowWelcome(state)) {
      if (!autoShown.current.welcome) {
        autoShown.current.welcome = true
        setWelcomeOpen(true)
      }
    } else if (unreadNews.length > 0 && !autoShown.current.news && !welcomeOpen) {
      autoShown.current.news = true
      setNewsOpen(true)
    }
  }, [active, state, unreadNews.length, welcomeOpen])

  useEffect(() => {
    if (!active) return undefined
    const open = () => setWelcomeOpen(true)
    window.addEventListener(OPEN_WELCOME_EVENT, open)
    return () => window.removeEventListener(OPEN_WELCOME_EVENT, open)
  }, [active])

  const patch = useCallback(
    async (changes) => {
      setState((s) => (s ? { ...s, ...changes } : s))
      await updateOnboardingState(supabase, userId, changes)
    },
    [userId]
  )

  const closeWelcome = useCallback(() => {
    setWelcomeOpen(false)
    if (state && !state.welcome_seen_at) patch({ welcome_seen_at: new Date().toISOString() })
  }, [state, patch])

  const markNewsSeen = useCallback(async () => {
    if (!state) return
    const changes = markSeenPatch(state, news)
    if (changes.news_seen_through !== state.news_seen_through) await patch(changes)
  }, [state, news, patch])

  const closeNews = useCallback(() => {
    setNewsOpen(false)
    markNewsSeen()
  }, [markNewsSeen])

  const dismissChecklist = useCallback(() => patch({ onboarding_dismissed_at: new Date().toISOString() }), [patch])
  const restoreChecklist = useCallback(() => patch({ onboarding_dismissed_at: null }), [patch])
  const openWelcome = useCallback(() => setWelcomeOpen(true), [])

  const checklist = useMemo(() => evaluateChecklist(facts), [facts])

  const value = useMemo(
    () => ({
      enabled: active,
      state,
      news,
      unreadNews,
      checklist,
      factsLoaded: !!facts,
      openWelcome,
      markNewsSeen,
      dismissChecklist,
      restoreChecklist,
    }),
    [active, state, news, unreadNews, checklist, facts, openWelcome, markNewsSeen, dismissChecklist, restoreChecklist]
  )

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {active && (
        <>
          <WelcomeModal
            open={welcomeOpen}
            onClose={closeWelcome}
            checklist={checklist}
            checklistDismissed={!!state?.onboarding_dismissed_at}
            onRestoreChecklist={restoreChecklist}
          />
          <NewsModal open={newsOpen} entries={unreadNews} onClose={closeNews} />
        </>
      )}
    </OnboardingContext.Provider>
  )
}

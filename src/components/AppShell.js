'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { supabase } from '../lib/supabase'
import { fetchTracks } from '../lib/lookups'
import Sidebar from './Sidebar'
import TopNav from './TopNav'
import Footer from './Footer'
import AppBackground from './AppBackground'
import OnboardingProvider from './OnboardingProvider'
import { PROFILE_UPDATED_EVENT } from '../lib/navigation'
import { parseCoachPath } from '../lib/coachContext'
import { isLegalPath } from '../lib/legal'
import { GLASS_EVENT, readGlassPref } from '../lib/glass'

export default function AppShell({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const { setTheme } = useTheme()

  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [tracks, setTracks] = useState([])
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [glassEnabled, setGlassEnabled] = useState(true)

  // Paths that don't need the Shell (Login, Register and password recovery)
  const isAuthPage = ['/login', '/register', '/forgot-password', '/reset-password'].includes(pathname)
  // Public tools that match v1 behavior: usable without an account (Gear Architect, Velodromes map)
  const isPublicPage = pathname.startsWith('/gears')
  // Legal pages are always public and render without waiting for the session (crawlers, Google's reviewers).
  const isLegalPage = isLegalPath(pathname)

  useEffect(() => {
    setGlassEnabled(readGlassPref())
    const sync = () => setGlassEnabled(readGlassPref())
    window.addEventListener(GLASS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(GLASS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (glassEnabled && !isAuthPage) root.dataset.glass = 'on'
    else delete root.dataset.glass
  }, [glassEnabled, isAuthPage])

  const fetchProfile = async (userId) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (data) {
      setProfile(data)
      if (data.theme_preference) {
        setTheme(data.theme_preference)
      }
    }
  }

  useEffect(() => {
    // A reset link that lands on any other page still opens the new-password form.
    if (window.location.hash.includes('type=recovery') && pathname !== '/reset-password') {
      router.replace(`/reset-password${window.location.hash}`)
      return
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)

      if (!currentUser && !isAuthPage && !isPublicPage && !isLegalPage) {
        router.push('/login')
      } else if (currentUser) {
        fetchProfile(currentUser.id)
      }
      setCheckingAuth(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && pathname !== '/reset-password') {
        router.replace('/reset-password')
        return
      }
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (!currentUser && !isAuthPage && !isPublicPage && !isLegalPage) {
        router.push('/login')
      } else if (currentUser) {
        fetchProfile(currentUser.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [router, pathname, isAuthPage, isPublicPage, isLegalPage, setTheme])

  // The settings page announces saves so the banner/theme pick up the new profile.
  useEffect(() => {
    if (!user?.id) return
    const refresh = () => fetchProfile(user.id)
    window.addEventListener(PROFILE_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, refresh)
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    fetchTracks(supabase).then(({ data }) => setTracks(data || []))
  }, [user?.id])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Show Login/Register pages in a clean full window
  if (isAuthPage) {
    return <main className="min-h-screen">{children}</main>
  }

  if (isLegalPage) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-surface-dark text-slate-900 dark:text-slate-100">
        <header className="border-b border-slate-200 dark:border-surface-darkBorder bg-white/60 dark:bg-surface-darkCard/40 px-4 sm:px-6 py-3">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <Link href="/" className="font-extrabold text-slate-800 dark:text-slate-200">
              Velocity<span className="text-emerald-500 dark:text-brand-neon">Stack</span>
            </Link>
            <Link href={user ? '/' : '/login'} className="text-xs font-bold text-emerald-600 dark:text-brand-neon hover:underline">
              {user ? 'Open the app' : 'Sign in'}
            </Link>
          </div>
        </header>
        <main className="flex-1 w-full px-4 sm:px-6 py-6 sm:py-10">{children}</main>
        <Footer />
      </div>
    )
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-surface-dark text-slate-500 font-bold text-xs uppercase tracking-widest">
        Verifying athlete credentials...
      </div>
    )
  }

  // Onboarding/news are the signed-in user's own state: never active inside an athlete context.
  const ownContext = !parseCoachPath(pathname).riderId

  return (
    <OnboardingProvider userId={user?.id} enabled={!!user && ownContext}>
    <div className="app-shell-root flex min-h-screen bg-slate-100 dark:bg-surface-dark text-slate-900 dark:text-slate-100 transition-colors duration-300">
      <AppBackground />

      {/* 1. Responsive Sidebar (persistent on desktop, drawer on mobile) */}
      <Sidebar
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        isAdmin={!!profile?.is_admin}
      />

      {/* 2. Main application body */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav
          user={user}
          profile={profile}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onSignOut={handleSignOut}
          tracks={tracks}
        />

        {/* Dynamic page content (Dashboard, Activity Detail, Maps, etc.) */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
          {children}
        </main>

        {/* 3. Global footer */}
        <Footer />
      </div>
    </div>
    </OnboardingProvider>
  )
}
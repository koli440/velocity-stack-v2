'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { supabase } from '../lib/supabase'
import Sidebar from './Sidebar'
import TopNav from './TopNav'
import Footer from './Footer'
import ProfileSettingsModal from './ProfileSettingsModal'

export default function AppShell({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const { setTheme } = useTheme()

  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // Paths that don't need the Shell (Login and Register)
  const isAuthPage = pathname === '/login' || pathname === '/register'
  // Public tools that match v1 behavior: usable without an account (Gear Architect, Velodromes map)
  const isPublicPage = pathname.startsWith('/gears')

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
    supabase.auth.getSession().then(({ data: { session } }) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)

      if (!currentUser && !isAuthPage && !isPublicPage) {
        router.push('/login')
      } else if (currentUser) {
        fetchProfile(currentUser.id)
      }
      setCheckingAuth(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (!currentUser && !isAuthPage && !isPublicPage) {
        router.push('/login')
      } else if (currentUser) {
        fetchProfile(currentUser.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [router, isAuthPage, isPublicPage, setTheme])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Show Login/Register pages in a clean full window
  if (isAuthPage) {
    return <main className="min-h-screen">{children}</main>
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-surface-dark text-slate-500 font-bold text-xs uppercase tracking-widest">
        Verifying athlete credentials...
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-surface-dark text-slate-900 dark:text-slate-100 transition-colors duration-300">
      {/* 1. Responsive Sidebar (persistent on desktop, drawer on mobile) */}
      <Sidebar
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* 2. Main application body */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav
          user={user}
          profile={profile}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onSignOut={handleSignOut}
        />

        {/* Dynamic page content (Dashboard, Activity Detail, Maps, etc.) */}
        <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-6xl w-full mx-auto space-y-6">
          {children}
        </main>

        {/* 3. Global footer */}
        <Footer />
      </div>

      {/* Global rider profile modal */}
      <ProfileSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false)
          if (user?.id) fetchProfile(user.id)
        }}
        user={user}
        tracks={[]}
      />
    </div>
  )
}
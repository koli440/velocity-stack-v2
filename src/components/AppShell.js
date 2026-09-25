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

  // Cesty, které nepotřebují Shell (Login a Register)
  const isAuthPage = pathname === '/login' || pathname === '/register'

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

      if (!currentUser && !isAuthPage) {
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
      if (!currentUser && !isAuthPage) {
        router.push('/login')
      } else if (currentUser) {
        fetchProfile(currentUser.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [router, isAuthPage, setTheme])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Přihlašovací/Registrační stránky zobrazujeme v čistém plném okně
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
      {/* 1. Responzivní Sidebar (desktop trvalý, mobil drawer) */}
      <Sidebar
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* 2. Hlavní aplikační tělo */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav
          user={user}
          profile={profile}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onSignOut={handleSignOut}
        />

        {/* Dynamický obsah stránky (Dashboard, Detail aktivity, Mapy atd.) */}
        <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-6xl w-full mx-auto space-y-6">
          {children}
        </main>

        {/* 3. Globální patička */}
        <Footer />
      </div>

      {/* Globální modál profilu jezdce */}
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
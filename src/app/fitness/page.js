'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import FitnessView from '../../components/FitnessView'

// Own Fitness / Fatigue / Form page (issue #290). Every query filters by the signed-in rider.
export default function FitnessPage() {
  const router = useRouter()
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUserId(session.user.id)
      else router.push('/login')
    })
  }, [router])

  return <FitnessView userId={userId} />
}

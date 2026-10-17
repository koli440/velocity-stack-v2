'use client'

import { createContext, useContext } from 'react'

export const AthleteContext = createContext({ riderId: null, athlete: null })

// Athlete context of the current /coach/<riderId>/... route (null outside of it).
export const useAthlete = () => useContext(AthleteContext)

'use client'

import { createContext, useContext } from 'react'

// Auth status published by AppShell so pages can tell "still checking" from "signed out".
export const AuthStateContext = createContext({ checking: true, user: null })
export const useAuthState = () => useContext(AuthStateContext)

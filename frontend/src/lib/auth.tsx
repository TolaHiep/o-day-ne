import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiAuth, authToken } from './api'
import type { User, AuthProviders } from '../types'

type AuthState = {
  user: User | null
  ready: boolean
  providers: AuthProviders | null
  popupOpen: boolean
  popupIntent: string | null
  openPopup: (intent?: string) => void
  closePopup: () => void
  loginWithDemo: (input: { provider: string; email: string; name?: string; role?: 'seeker' | 'landlord' }) => Promise<User>
  loginWithGoogle: (code: string, state: string) => Promise<User>
  setRole: (role: 'seeker' | 'landlord') => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [providers, setProviders] = useState<AuthProviders | null>(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupIntent, setPopupIntent] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const t = authToken.get()
      if (!t) { setUser(null); return }
      const r = await apiAuth.session()
      setUser(r.user)
    } catch { setUser(null) }
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const p = await apiAuth.providers()
        setProviders(p.providers)
      } catch { /* ignore */ }
      await refresh()
      setReady(true)
    })()
  }, [refresh])

  const loginWithDemo = useCallback(async (input: { provider: string; email: string; name?: string; role?: 'seeker' | 'landlord' }) => {
    const r = await apiAuth.demo(input)
    setUser(r.user)
    setPopupOpen(false)
    setPopupIntent(null)
    return r.user
  }, [])

  const loginWithGoogle = useCallback(async (code: string, state: string) => {
    const r = await apiAuth.google(code, state)
    setUser(r.user)
    setPopupOpen(false)
    setPopupIntent(null)
    return r.user
  }, [])

  const setRole = useCallback(async (role: 'seeker' | 'landlord') => {
    const r = await apiAuth.setRole(role)
    setUser(r.user)
  }, [])

  const logout = useCallback(async () => {
    await apiAuth.logout()
    setUser(null)
  }, [])

  const openPopup = useCallback((intent?: string) => {
    setPopupIntent(intent || null)
    setPopupOpen(true)
  }, [])
  const closePopup = useCallback(() => { setPopupOpen(false); setPopupIntent(null) }, [])

  const value = useMemo<AuthState>(() => ({
    user, ready, providers, popupOpen, popupIntent,
    openPopup, closePopup,
    loginWithDemo, loginWithGoogle, setRole, logout, refresh,
  }), [user, ready, providers, popupOpen, popupIntent, openPopup, closePopup, loginWithDemo, loginWithGoogle, setRole, logout, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be inside AuthProvider')
  return v
}

export function useRequireUser(intent?: string): { user: User | null; gate: () => boolean } {
  const auth = useAuth()
  return {
    user: auth.user,
    gate: () => {
      if (auth.user) return true
      auth.openPopup(intent)
      return false
    },
  }
}

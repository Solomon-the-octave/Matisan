import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api from '../api'
import { getToken, getStoredUser, saveSession, saveUser, clearSession, purgeLegacySession } from '../authStorage'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // Restore this tab's own session. Without a token there is nothing to check.
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null))
  const [loading, setLoading] = useState(() => !!getToken())

  useEffect(() => {
    purgeLegacySession()
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    api
      .get('/auth/me')
      .then((res) => {
        setUser(res.data.user)
        saveUser(res.data.user)
      })
      .catch(() => {
        clearSession()
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password })
    saveSession(res.data.token, res.data.user)
    setUser(res.data.user)
    return res.data.user
  }, [])

  const logout = useCallback(() => {
    clearSession()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

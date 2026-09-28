import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('matisan_user')
    return raw ? JSON.parse(raw) : null
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('matisan_token')
    if (!token) {
      setLoading(false)
      return
    }
    api
      .get('/auth/me')
      .then((res) => {
        setUser(res.data.user)
        localStorage.setItem('matisan_user', JSON.stringify(res.data.user))
      })
      .catch(() => {
        localStorage.removeItem('matisan_token')
        localStorage.removeItem('matisan_user')
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password })
    localStorage.setItem('matisan_token', res.data.token)
    localStorage.setItem('matisan_user', JSON.stringify(res.data.user))
    setUser(res.data.user)
    return res.data.user
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('matisan_token')
    localStorage.removeItem('matisan_user')
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

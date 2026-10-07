import axios from 'axios'
import { getToken, clearSession } from './authStorage'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearSession()
      if (!location.pathname.startsWith('/login')) location.replace('/login')
    }
    return Promise.reject(err)
  }
)

export default api

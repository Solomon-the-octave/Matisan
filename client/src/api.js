import axios from 'axios'
import { getToken, clearSession } from './authStorage'
import { cacheable, cachePut, cacheGet, isNetworkError } from './offline'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => {
    if (res.config.method === 'get' && cacheable(res.config.url) && res.config.responseType !== 'blob') cachePut(res.config, res.data)
    return res
  },
  (err) => {
    // No signal: show the last data this phone loaded instead of an error.
    const c = err.config
    if (c && c.method === 'get' && cacheable(c.url) && isNetworkError(err)) {
      const hit = cacheGet(c)
      if (hit) return Promise.resolve({ data: hit.data, status: 200, config: c, headers: {}, fromCache: true, cachedAt: hit.at })
    }
    if (err.response?.status === 401) {
      clearSession()
      if (!location.pathname.startsWith('/login')) location.replace('/login')
    }
    return Promise.reject(err)
  }
)

export default api

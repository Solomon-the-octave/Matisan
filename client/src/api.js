import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('matisan_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('matisan_token')
      localStorage.removeItem('matisan_user')
      if (!location.pathname.startsWith('/login')) location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

import axios from 'axios'
import { useAuth } from '../composables/useAuth'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 300000,
  headers: { 'Content-Type': 'application/json' }
})

// Attach Authorization header on every request
api.interceptors.request.use((config) => {
  const { apiKey } = useAuth()
  if (apiKey.value) {
    config.headers.Authorization = `Bearer ${apiKey.value}`
  }
  return config
})

export default api

export async function fetchGstackPersonas() {
  const res = await api.get('/gstack/personas')
  return res.data
}

export async function reloadGstackPersonas(path) {
  const res = await api.post('/gstack/reload', { path })
  return res.data
}

export function connectWS(scenarioId) {
  const { apiKey } = useAuth()
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const base = import.meta.env.VITE_WS_BASE_URL || `${proto}://${location.host}`
  const key = apiKey.value ? `?apiKey=${encodeURIComponent(apiKey.value)}` : ''
  return new WebSocket(`${base}/api/simulations/ws/${scenarioId}${key}`)
}

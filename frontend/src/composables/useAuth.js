import { ref, computed, watch } from 'vue'

const STORAGE_KEY = 'cs-openrouter-key'
const USER_KEY = 'cs-openrouter-user'

const apiKey = ref(localStorage.getItem(STORAGE_KEY) || '')
const userInfo = ref(JSON.parse(localStorage.getItem(USER_KEY) || 'null'))

const isAuthenticated = computed(() => !!apiKey.value)

async function fetchUserInfo() {
  if (!apiKey.value) return
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey.value}` }
    })
    if (res.ok) {
      const data = await res.json()
      userInfo.value = data.data || data
      localStorage.setItem(USER_KEY, JSON.stringify(userInfo.value))
    }
  } catch {
    // silently fail — user info is optional
  }
}

function login(key) {
  if (!key || !key.startsWith('sk-or-')) {
    console.warn('[auth] Invalid OpenRouter key format, rejecting')
    return false
  }
  apiKey.value = key
  localStorage.setItem(STORAGE_KEY, key)
  fetchUserInfo()
  return true
}

function logout() {
  apiKey.value = ''
  userInfo.value = null
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(USER_KEY)
}

/**
 * Start OpenRouter OAuth PKCE flow.
 * Redirects the browser to OpenRouter's auth page.
 */
function startOAuthFlow() {
  const callbackUrl = `${window.location.origin}/auth/callback`
  const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}`
  window.location.href = authUrl
}

// Validate stored key on load — clear if invalid
if (apiKey.value && !apiKey.value.startsWith('sk-or-')) {
  console.warn('[auth] Clearing invalid stored key')
  apiKey.value = ''
  userInfo.value = null
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(USER_KEY)
} else if (apiKey.value && !userInfo.value) {
  fetchUserInfo()
}

function refreshUserInfo() {
  fetchUserInfo()
}

export function useAuth() {
  return {
    apiKey,
    userInfo,
    isAuthenticated,
    login,
    logout,
    startOAuthFlow,
    refreshUserInfo,
  }
}

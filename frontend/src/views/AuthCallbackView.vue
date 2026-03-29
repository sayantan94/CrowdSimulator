<template>
  <div class="callback-page">
    <div class="callback-card animate-up">
      <div v-if="error" class="callback-error">
        <p class="callback-error-text">{{ error }}</p>
        <router-link to="/login" class="btn-main callback-btn">Back to Login</router-link>
      </div>
      <div v-else class="callback-loading">
        <div class="callback-spinner"></div>
        <span class="callback-text font-mono">AUTHENTICATING</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { login } = useAuth()
const error = ref('')

async function exchangeCode(code) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`OpenRouter returned ${res.status}: ${detail}`)
    }
    const data = await res.json()
    return data.key
  } catch (e) {
    throw new Error(`Failed to exchange code: ${e.message}`)
  }
}

onMounted(async () => {
  const hash = window.location.hash.substring(1)
  const params = new URLSearchParams(hash)
  const query = new URLSearchParams(window.location.search)

  const code = params.get('code') || query.get('code')

  if (!code) {
    error.value = 'No authentication code received from OpenRouter.'
    return
  }

  try {
    const apiKey = await exchangeCode(code)
    if (!apiKey) throw new Error('No API key returned')
    login(apiKey)
    router.replace('/')
  } catch (e) {
    error.value = e.message
  }
})
</script>

<style scoped>
.callback-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  padding: 24px;
}

.callback-card {
  width: 100%;
  max-width: 360px;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px 24px;
  text-align: center;
}

.callback-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.callback-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--green);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.callback-text {
  font-size: 10px;
  color: var(--text3);
  letter-spacing: 1px;
}

.callback-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.callback-error-text {
  font-size: 13px;
  color: var(--red);
}

.callback-btn {
  display: inline-block;
  text-decoration: none;
}
</style>

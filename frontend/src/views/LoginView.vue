<template>
  <div class="login-page">
    <div class="login-card animate-up">
      <div class="login-header">
        <h1 class="login-brand">CrowdSimulator</h1>
        <p class="login-tagline">Preview audience reaction before you post.</p>
      </div>

      <div class="login-body">
        <label class="login-label font-mono">OPENROUTER API KEY</label>
        <div class="login-input-wrap">
          <input
            v-model="keyInput"
            type="password"
            class="login-input"
            placeholder="sk-or-v1-..."
            spellcheck="false"
            autocomplete="off"
            @keydown.enter="handleLogin"
          />
        </div>

        <button class="btn-main login-btn" :disabled="!keyInput.trim()" @click="handleLogin">
          Continue
        </button>

        <div class="login-divider">
          <span class="login-divider-line"></span>
          <span class="login-divider-text font-mono">OR</span>
          <span class="login-divider-line"></span>
        </div>

        <button class="login-oauth" @click="startOAuthFlow">
          Login with OpenRouter
          <span class="login-oauth-arrow">&rarr;</span>
        </button>
      </div>

      <p v-if="error" class="login-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { login, startOAuthFlow } = useAuth()

const keyInput = ref('')
const error = ref('')

function handleLogin() {
  const key = keyInput.value.trim()
  if (!key) return

  if (!key.startsWith('sk-or-')) {
    error.value = 'Key should start with sk-or-'
    return
  }

  error.value = ''
  login(key)
  router.push('/')
}
</script>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  padding: 24px;
}

.login-card {
  width: 100%;
  max-width: 380px;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.login-header {
  padding: 28px 24px 20px;
  text-align: center;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.login-brand {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--text);
}

.login-tagline {
  margin-top: 4px;
  font-size: 13px;
  color: var(--text3);
}

.login-body {
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.login-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text3);
}

.login-input-wrap {
  display: flex;
}

.login-input {
  width: 100%;
  padding: 10px 12px;
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: border-color 0.15s;
}

.login-input::placeholder {
  color: var(--text3);
}

.login-input:focus {
  border-color: var(--border2);
  background: var(--white);
}

.login-btn {
  width: 100%;
  margin-top: 4px;
}

.login-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0;
}

.login-divider-line {
  flex: 1;
  height: 1px;
  background: var(--border);
}

.login-divider-text {
  font-size: 9px;
  color: var(--text3);
  letter-spacing: 0.5px;
}

.login-oauth {
  width: 100%;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s;
}

.login-oauth:hover {
  border-color: var(--border2);
  color: var(--text);
  background: var(--surface2);
}

.login-oauth-arrow {
  font-size: 14px;
}

.login-error {
  padding: 10px 24px 16px;
  font-size: 12px;
  color: var(--red);
}
</style>

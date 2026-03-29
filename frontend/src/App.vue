<template>
  <div id="shell">
    <!-- Topbar -->
    <div class="topbar" v-if="showTopbar">
      <div class="tb-brand" @click="router.push('/')" style="cursor:pointer">CrowdSim</div>
      <div class="tb-sep"></div>
      <div class="tb-phases">
        <router-link
          v-for="phase in phases"
          :key="phase.name"
          :to="phase.path"
          class="tb-phase"
          :class="{
            active: currentPhase === phase.name,
            done: phaseIndex(phase.name) < phaseIndex(currentPhase)
          }"
        >
          {{ phase.label }}
        </router-link>
      </div>

      <div class="tb-right">
        <!-- History dropdown -->
        <div class="tb-hist-wrap" ref="histWrap">
          <button class="tb-history" @click="toggleHistory" :class="{ open: historyOpen }">
            <span class="tb-history-icon">&#9776;</span>
            <span class="tb-history-label" v-if="recentScenarios.length">History</span>
            <span class="tb-history-label" v-else>Recent</span>
            <span class="tb-history-count" v-if="recentScenarios.length">{{ recentScenarios.length }}</span>
          </button>

          <!-- Overlay dropdown -->
          <Transition name="dd">
            <div class="hist-dropdown" v-if="historyOpen">
              <div class="hd-head">
                <span class="hd-title">Recent Simulations</span>
                <button class="hd-close" @click="historyOpen = false">&times;</button>
              </div>
              <div class="hd-list" v-if="recentScenarios.length">
                <div
                  v-for="s in recentScenarios" :key="s.id"
                  class="hd-item"
                  @click="goToScenario(s)"
                >
                  <div class="hd-status" :class="s.status"></div>
                  <div class="hd-info">
                    <div class="hd-text">{{ truncate(s.post_text, 50) }}</div>
                    <div class="hd-meta">{{ s.platforms?.join(' + ') }} · {{ s.agent_count }} agents · {{ s.rounds }} rounds</div>
                  </div>
                  <span class="hd-badge" :class="s.status">{{ s.status }}</span>
                </div>
              </div>
              <div class="hd-empty" v-else>No simulations yet</div>
            </div>
          </Transition>
        </div>

        <div class="tb-sep"></div>
        <button class="tb-theme" @click="toggleTheme" :title="isDark ? 'Switch to light' : 'Switch to dark'">
          <span v-if="isDark">&#9788;</span>
          <span v-else>&#9790;</span>
        </button>
        <div v-if="isAuthenticated" class="tb-user-wrap" ref="userWrap">
          <button class="tb-user" @click="userMenuOpen = !userMenuOpen" :class="{ open: userMenuOpen }">
            <span class="tb-user-dot"></span>
            <span class="tb-user-name">{{ displayName }}</span>
            <span class="tb-user-credit font-mono" v-if="usageDisplay">{{ usageDisplay }}</span>
          </button>
          <Transition name="dd">
            <div class="user-dropdown" v-if="userMenuOpen">
              <div class="ud-head">
                <span class="ud-label font-mono">ACCOUNT</span>
              </div>
              <div class="ud-body">
                <div class="ud-row">
                  <span class="ud-row-label">Tier</span>
                  <span class="ud-row-value">{{ userInfo?.is_free_tier ? 'Free' : 'Paid' }}</span>
                </div>
                <div class="ud-row" v-if="usageDisplay">
                  <span class="ud-row-label">Usage</span>
                  <span class="ud-row-value ud-credit">{{ usageDisplay }}</span>
                </div>
                <div class="ud-row" v-if="userInfo?.limit != null">
                  <span class="ud-row-label">Limit</span>
                  <span class="ud-row-value font-mono">{{ userInfo.limit != null ? `$${userInfo.limit}` : 'Unlimited' }}</span>
                </div>
                <div class="ud-row" v-if="userInfo?.limit_remaining != null">
                  <span class="ud-row-label">Remaining</span>
                  <span class="ud-row-value font-mono">${{ userInfo.limit_remaining.toFixed(2) }}</span>
                </div>
              </div>
              <div class="ud-actions">
                <button class="ud-logout" @click="handleLogout">Logout</button>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <!-- Click-outside overlay -->
    <div class="hist-backdrop" v-if="showTopbar && (historyOpen || userMenuOpen)" @click="historyOpen = false; userMenuOpen = false"></div>

    <div class="tb-body">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from './api'
import { useAuth } from './composables/useAuth'

const route = useRoute()
const router = useRouter()
const { isAuthenticated, userInfo, logout } = useAuth()

const displayName = computed(() => {
  const u = userInfo.value
  if (!u) return 'Connected'
  if (u.is_free_tier) return 'Free Tier'
  return 'OpenRouter'
})

const usageDisplay = computed(() => {
  const u = userInfo.value
  if (!u || u.usage == null) return null
  return `$${u.usage.toFixed(2)}`
})

const userMenuOpen = ref(false)
const userWrap = ref(null)

const showTopbar = computed(() => {
  const name = route.name
  return name !== 'login' && name !== 'auth-callback'
})

function handleLogout() {
  logout()
  router.push('/login')
}

const phases = [
  { name: 'compose', label: 'Compose', path: '/' },
  { name: 'research', label: 'Research', path: '#' },
  { name: 'simulate', label: 'Simulate', path: '#' },
  { name: 'results', label: 'Results', path: '#' }
]

const currentPhase = computed(() => route.name || 'compose')
const phaseOrder = { compose: 0, research: 1, simulate: 2, results: 3 }
const phaseIndex = (name) => phaseOrder[name] ?? -1

// History dropdown
const historyOpen = ref(false)
const recentScenarios = ref([])

function toggleHistory() {
  historyOpen.value = !historyOpen.value
  if (historyOpen.value) loadHistory()
}

async function loadHistory() {
  try {
    const { data } = await api.get('/scenarios')
    recentScenarios.value = data.reverse().slice(0, 20)
  } catch {}
}

const truncate = (str, len) => {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '...' : str
}

function goToScenario(s) {
  historyOpen.value = false
  if (s.status === 'complete') {
    router.push(`/results/${s.id}`)
  } else {
    router.push(`/research/${s.id}`)
  }
}

// Close on navigation
watch(() => route.path, () => { historyOpen.value = false; userMenuOpen.value = false })

// Theme toggle
const isDark = ref(false)

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  localStorage.setItem('cs-theme', isDark.value ? 'dark' : 'light')
}

onMounted(() => {
  const saved = localStorage.getItem('cs-theme')
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    isDark.value = true
    document.documentElement.setAttribute('data-theme', 'dark')
  }
  loadHistory()
})
</script>

<style scoped>
#shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.topbar {
  height: 56px;
  background: var(--panel-glass-strong);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 18px;
  gap: 14px;
  flex-shrink: 0;
  z-index: 100;
  position: relative;
  backdrop-filter: blur(14px);
}

.tb-brand {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--text);
}

.tb-sep {
  width: 1px;
  height: 20px;
  background: var(--border);
}

.tb-phases {
  display: flex;
  gap: 6px;
  align-items: center;
}

.tb-phase {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
  padding: 7px 10px;
  border-radius: 999px;
  color: var(--text3);
  text-decoration: none;
  transition: all 0.2s;
  pointer-events: none;
}

.tb-phase.active {
  color: var(--text);
  background: var(--surface);
}

.tb-phase.done {
  color: var(--green);
}

.tb-right {
  margin-left: auto;
  display: flex;
  gap: 4px;
  align-items: center;
}

/* History button + dropdown wrapper */
.tb-hist-wrap {
  position: relative;
}

.tb-history {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text3);
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s;
}

.tb-history:hover {
  border-color: var(--border2);
  color: var(--text2);
}

.tb-history.open {
  border-color: var(--green-border);
  color: var(--green);
  background: var(--green-bg);
}

.tb-history-icon {
  font-size: 11px;
  line-height: 1;
}

.tb-history-label {
  font-weight: 600;
  letter-spacing: -0.01em;
}

.tb-history-count {
  font-size: 8px;
  font-weight: 700;
  background: var(--border);
  padding: 0 4px;
  border-radius: 3px;
  color: var(--text2);
}

.tb-history.open .tb-history-count {
  background: var(--green);
  color: #fff;
}

/* Overlay dropdown */
.hist-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 360px;
  max-height: 400px;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 200;
}

.hd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}

.hd-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text2);
}

.hd-close {
  font-size: 16px;
  color: var(--text3);
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}

.hd-close:hover { color: var(--text); }

.hd-list {
  overflow-y: auto;
  flex: 1;
}

.hd-list::-webkit-scrollbar { width: 2px; }
.hd-list::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

.hd-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s;
}

.hd-item:last-child { border-bottom: none; }
.hd-item:hover { background: var(--surface); }

.hd-status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.hd-status.complete { background: var(--green); }
.hd-status.running { background: var(--amber); animation: pulse 1.5s infinite; }
.hd-status.created { background: var(--text3); }
.hd-status.error { background: var(--red); }

.hd-info {
  flex: 1;
  min-width: 0;
}

.hd-text {
  font-size: 12px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hd-meta {
  font-size: 11px;
  color: var(--text3);
  margin-top: 1px;
}

.hd-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.hd-badge.complete { background: var(--green-bg); color: var(--green); }
.hd-badge.running { background: var(--amber-bg); color: var(--amber); }
.hd-badge.created { background: var(--surface); color: var(--text3); }
.hd-badge.error { background: var(--red-bg); color: var(--red); }

.hd-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--text3);
}

/* Click-outside backdrop */
.hist-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
}

/* Dropdown transition */
.dd-enter-active { transition: all 0.15s ease-out; }
.dd-enter-from { opacity: 0; transform: translateY(-4px) scale(0.97); }
.dd-leave-active { transition: all 0.1s ease-in; }
.dd-leave-to { opacity: 0; transform: translateY(-4px) scale(0.97); }

.tb-pill {
  font-size: 9px;
  color: var(--text3);
  padding: 2px 8px;
  border-radius: 3px;
  background: var(--surface);
  border: 1px solid var(--border);
  letter-spacing: 0.3px;
}

.tb-theme {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--text3);
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid var(--border);
  background: var(--surface);
}

.tb-theme:hover {
  color: var(--text);
  border-color: var(--border2);
}

/* User menu */
.tb-user-wrap {
  position: relative;
}

.tb-user {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text3);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.tb-user:hover {
  border-color: var(--border2);
  color: var(--text2);
}

.tb-user.open {
  border-color: var(--green-border);
  color: var(--green);
  background: var(--green-bg);
}

.tb-user-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--green);
}

.tb-user-name {
  letter-spacing: -0.01em;
  font-size: 10px;
}

.tb-user-credit {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--green-bg);
  color: var(--green);
}

.tb-user.open .tb-user-credit {
  background: var(--green);
  color: #fff;
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 240px;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
  overflow: hidden;
  z-index: 200;
}

.ud-head {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.ud-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--text3);
}

.ud-body {
  padding: 6px 0;
}

.ud-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 12px;
}

.ud-row-label {
  font-size: 11px;
  color: var(--text3);
}

.ud-row-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
}

.ud-credit {
  color: var(--green);
}

.ud-actions {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
}

.ud-logout {
  font-size: 11px;
  font-weight: 600;
  color: var(--red);
  padding: 5px 14px;
  border-radius: 5px;
  border: 1px solid var(--red-border);
  background: var(--red-bg);
  cursor: pointer;
  transition: all 0.15s;
}

.ud-logout:hover {
  background: var(--red);
  color: #fff;
}

.tb-body {
  flex: 1;
  overflow: hidden;
  background: var(--bg);
}
</style>

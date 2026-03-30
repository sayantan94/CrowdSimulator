<template>
  <div class="results-view">
    <CrowdScene />
    <div class="results-inner">
      <!-- Loading -->
      <template v-if="loading">
        <div class="skel-grid">
          <div v-for="n in 4" :key="n" class="skel skel-card"></div>
        </div>
        <div class="skel-row">
          <div class="skel skel-panel"></div>
          <div class="skel skel-panel"></div>
        </div>
      </template>

      <!-- Content — A/B comparison mode -->
      <template v-else-if="isAB && variantIds.length > 0">
        <div class="res-head">
          <div class="res-head-left">
            <h1 class="res-title">A/B Comparison</h1>
            <span class="res-badge font-mono ab-badge">{{ variantIds.length }} VARIANTS</span>
            <span class="res-badge font-mono">{{ scenarioId }}</span>
          </div>
          <div class="res-head-right">
            <button class="btn-outline" @click="router.push('/')">
              &larr; New Simulation
            </button>
          </div>
        </div>

        <!-- Variant post previews side by side -->
        <div class="ab-posts" :style="{ gridTemplateColumns: `repeat(${variantIds.length}, 1fr)` }">
          <div v-for="vid in variantIds" :key="vid" class="ab-post-card" :class="'ab-' + vid.toLowerCase()">
            <span class="ab-post-label font-mono">VARIANT {{ vid }}</span>
            <p class="ab-post-text">{{ variantTexts[vid] || '(text not available)' }}</p>
          </div>
        </div>

        <!-- Score comparison -->
        <section class="res-section">
          <div class="ab-scores" :style="{ gridTemplateColumns: `repeat(${variantIds.length}, 1fr)` }">
            <div v-for="vid in variantIds" :key="vid" class="ab-score-col">
              <div class="ab-col-label font-mono" :class="'ab-' + vid.toLowerCase()">{{ vid }}</div>
              <ScoreCards :results="abResults[vid]" />
            </div>
          </div>
        </section>

        <!-- Winner banner -->
        <div class="ab-winner" v-if="winner">
          <span class="ab-winner-label font-mono">RECOMMENDED</span>
          <span class="ab-winner-id font-mono" :class="'ab-' + winner.id.toLowerCase()">Variant {{ winner.id }}</span>
          <span class="ab-winner-reason">{{ winner.reason }}</span>
        </div>

        <!-- Strategy comparison -->
        <section class="res-section">
          <div class="ab-compare-grid" :style="{ gridTemplateColumns: `repeat(${variantIds.length}, 1fr)` }">
            <div v-for="vid in variantIds" :key="vid" class="ab-compare-col">
              <div class="ab-col-label font-mono" :class="'ab-' + vid.toLowerCase()">{{ vid }}</div>
              <StrategyPanel :strategy="abResults[vid].strategy" />
            </div>
          </div>
        </section>

        <!-- Factions comparison -->
        <section class="res-section">
          <div class="ab-compare-grid" :style="{ gridTemplateColumns: `repeat(${variantIds.length}, 1fr)` }">
            <div v-for="vid in variantIds" :key="vid" class="ab-compare-col">
              <div class="ab-col-label font-mono" :class="'ab-' + vid.toLowerCase()">{{ vid }}</div>
              <FactionBreakdown :factions="abResults[vid].factions" />
            </div>
          </div>
        </section>

        <!-- Verdict comparison -->
        <section class="res-section">
          <div class="card">
            <div class="pnl-h">
              <span class="pnl-t">VERDICT COMPARISON</span>
            </div>
            <div class="pnl-b">
              <div class="ab-verdicts" :style="{ gridTemplateColumns: `repeat(${variantIds.length}, 1fr)` }">
                <div v-for="vid in variantIds" :key="vid" class="ab-verdict" :class="'ab-' + vid.toLowerCase()">
                  <div class="ab-verdict-header font-mono">VARIANT {{ vid }}</div>
                  <p class="ab-verdict-text">{{ abResults[vid].verdict }}</p>
                  <div class="ab-verdict-rewrite" v-if="abResults[vid].suggested_rewrite">
                    <span class="ab-verdict-rl font-mono">SUGGESTED REWRITE</span>
                    <p>{{ abResults[vid].suggested_rewrite }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Footer -->
        <div class="res-footer">
          <button class="btn-main" @click="router.push('/')">
            Run Another Simulation &rarr;
          </button>
        </div>
      </template>

      <!-- Content — Single simulation mode -->
      <template v-else-if="results">
        <!-- Header -->
        <div class="res-head">
          <div class="res-head-left">
            <h1 class="res-title">Simulation Report</h1>
            <span class="res-badge font-mono">{{ results.scenario_id }}</span>
            <span class="res-badge font-mono" v-if="results.agents">{{ results.agents.length }} agents</span>
            <span class="res-badge font-mono" v-if="results.actions">{{ results.actions.length }} actions</span>
          </div>
          <div class="res-head-right">
            <button class="btn-outline" @click="router.push('/')">
              &larr; New Simulation
            </button>
          </div>
        </div>

        <!-- Original post preview -->
        <div class="res-original" v-if="originalPost">
          <span class="res-orig-lbl font-mono">ORIGINAL POST</span>
          <p class="res-orig-text">{{ originalPost }}</p>
        </div>

        <!-- Score cards -->
        <section class="res-section">
          <ScoreCards :results="results" />
        </section>

        <!-- Strategy + Rewrite (moved up for immediate visibility) -->
        <section class="res-row two-col-55">
          <StrategyPanel :strategy="results.strategy" />
          <RewriteSuggestion
            :original="originalPost"
            :rewrite="results.suggested_rewrite"
            @rerun="handleRerun"
          />
        </section>

        <!-- Factions + Themes -->
        <section class="res-row two-col">
          <FactionBreakdown :factions="results.factions" />
          <ReactionThemes :themes="results.themes" />
        </section>

        <!-- Agent Interaction Graph -->
        <section class="res-section" v-if="results.agents && results.agents.length">
          <div class="card" :class="{ 'graph-card-expanded': graphExpanded }">
            <div class="pnl-h">
              <span class="pnl-t">AGENT INTERACTION NETWORK</span>
              <div class="pnl-h-right">
                <span class="pnl-meta font-mono">{{ results.agents.length }} nodes · {{ edgeCount }} links</span>
                <button class="graph-toggle font-mono" @click="graphExpanded = !graphExpanded">
                  {{ graphExpanded ? '⊟ COLLAPSE' : '⊞ EXPAND' }}
                </button>
              </div>
            </div>
            <div class="pnl-b graph-container" :class="{ expanded: graphExpanded }">
              <InteractionGraph :agents="results.agents" :actions="results.actions || []" />
            </div>
          </div>
        </section>

        <!-- Agent Profiles -->
        <section class="res-section" v-if="results.agents && results.agents.length">
          <div class="card">
            <div class="pnl-h">
              <span class="pnl-t">AGENT PROFILES</span>
              <span class="pnl-meta font-mono">{{ results.agents.length }} personas</span>
            </div>
            <div class="pnl-b">
              <!-- Archetype breakdown bar -->
              <div class="rp-arch-bar" v-if="archetypeBreakdown.length">
                <div
                  v-for="a in archetypeBreakdown" :key="a.name"
                  class="rp-arch-seg"
                  :style="{ flex: a.count, background: archColor(a.name) }"
                  :title="`${a.name}: ${a.count}`"
                ></div>
              </div>
              <div class="rp-arch-legend">
                <span v-for="a in archetypeBreakdown" :key="a.name" class="rp-arch-item font-mono">
                  <span class="rp-arch-dot" :style="{ background: archColor(a.name) }"></span>
                  {{ a.name }} ({{ a.count }})
                </span>
              </div>
              <div class="rp-grid">
                <div
                  v-for="agent in results.agents" :key="agent.agent_id"
                  class="rp-card"
                  :class="{ expanded: expandedAgent === agent.agent_id }"
                  @click="expandedAgent = expandedAgent === agent.agent_id ? null : agent.agent_id"
                >
                  <div class="rp-top">
                    <div class="rp-av" :style="{ background: archColor(agent.archetype) }">
                      {{ initials(agent.name) }}
                    </div>
                    <div class="rp-info">
                      <div class="rp-name">{{ agent.name }}</div>
                      <div class="rp-handle font-mono">@{{ agent.username }}</div>
                    </div>
                    <span class="rp-arch-badge font-mono" :style="{ color: archColor(agent.archetype) }">{{ agent.archetype }}</span>
                  </div>
                  <div class="rp-demo font-mono">
                    <span v-if="agent.age">{{ agent.age }}y</span>
                    <span v-if="agent.gender">{{ agent.gender }}</span>
                    <span v-if="agent.mbti">{{ agent.mbti }}</span>
                    <span v-if="agent.profession">{{ agent.profession }}</span>
                  </div>
                  <div class="rp-metrics">
                    <div class="rp-m">
                      <span class="rp-ml font-mono">SENT</span>
                      <span class="rp-mv font-mono" :class="sentClass(agent.sentiment_bias)">{{ fmtSent(agent.sentiment_bias) }}</span>
                    </div>
                    <div class="rp-m">
                      <span class="rp-ml font-mono">INFL</span>
                      <span class="rp-mv font-mono">{{ (agent.influence_weight || 0).toFixed(1) }}</span>
                    </div>
                    <div class="rp-m">
                      <span class="rp-ml font-mono">ACTS</span>
                      <span class="rp-mv font-mono">{{ agentActionCounts[agent.agent_id] || 0 }}</span>
                    </div>
                  </div>
                  <div class="rp-bio" v-if="agent.bio">{{ agent.bio }}</div>
                  <!-- Expanded -->
                  <div class="rp-expanded" v-if="expandedAgent === agent.agent_id">
                    <div class="rp-research" v-if="agent.research_basis">
                      <span class="rp-sub-lbl font-mono">RESEARCH BASIS</span>
                      <p>{{ agent.research_basis }}</p>
                    </div>
                    <div class="rp-topics" v-if="agent.interested_topics && agent.interested_topics.length">
                      <span class="rp-sub-lbl font-mono">INTERESTS</span>
                      <div class="rp-tag-row">
                        <span v-for="t in agent.interested_topics" :key="t" class="rp-tag font-mono">{{ t }}</span>
                      </div>
                    </div>
                    <div class="rp-persona" v-if="agent.persona">
                      <span class="rp-sub-lbl font-mono">PERSONA</span>
                      <p>{{ agent.persona }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Platform Engagement Breakdown -->
        <section class="res-row two-col" v-if="results.actions && results.actions.length">
          <div class="card">
            <div class="pnl-h">
              <span class="pnl-t">PLATFORM BREAKDOWN</span>
              <span class="pnl-meta font-mono">by action type</span>
            </div>
            <div class="pnl-b">
              <div class="pb-row" v-for="plat in platformStats" :key="plat.name">
                <div class="pb-plat">
                  <span class="pb-dot" :class="plat.name"></span>
                  <span class="pb-name font-mono">{{ plat.name.toUpperCase() }}</span>
                  <span class="pb-total font-mono">{{ plat.total }}</span>
                </div>
                <div class="pb-bars">
                  <div
                    v-for="at in plat.types" :key="at.type"
                    class="pb-bar"
                    :style="{ width: at.pct + '%', background: actionColor(at.type) }"
                    :title="`${at.type}: ${at.count}`"
                  ></div>
                </div>
                <div class="pb-legend">
                  <span v-for="at in plat.types" :key="at.type" class="pb-lg font-mono">
                    <span class="pb-lg-dot" :style="{ background: actionColor(at.type) }"></span>
                    {{ at.type.replace(/_/g, ' ').toLowerCase() }} ({{ at.count }})
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Action Type Distribution -->
          <div class="card">
            <div class="pnl-h">
              <span class="pnl-t">ACTION DISTRIBUTION</span>
              <span class="pnl-meta font-mono">{{ results.actions.length }} total</span>
            </div>
            <div class="pnl-b">
              <div v-for="at in actionTypeDist" :key="at.type" class="ad-row">
                <span class="ad-label font-mono">{{ at.type.replace(/_/g, ' ') }}</span>
                <div class="ad-track">
                  <div class="ad-fill" :style="{ width: at.pct + '%', background: actionColor(at.type) }"></div>
                </div>
                <span class="ad-val font-mono">{{ at.count }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Simulation Feed / Timeline -->
        <section class="res-section" v-if="results.actions && results.actions.length">
          <div class="card">
            <div class="pnl-h">
              <span class="pnl-t">SIMULATION FEED</span>
              <div class="feed-controls">
                <button
                  class="feed-filter font-mono"
                  :class="{ active: feedFilter === 'all' }"
                  @click="feedFilter = 'all'"
                >ALL</button>
                <button
                  class="feed-filter font-mono"
                  :class="{ active: feedFilter === 'twitter' }"
                  @click="feedFilter = 'twitter'"
                >TWITTER</button>
                <button
                  class="feed-filter font-mono"
                  :class="{ active: feedFilter === 'reddit' }"
                  @click="feedFilter = 'reddit'"
                >REDDIT</button>
                <button
                  class="feed-filter font-mono"
                  :class="{ active: feedFilter === 'content' }"
                  @click="feedFilter = 'content'"
                >WITH CONTENT</button>
              </div>
            </div>
            <div class="pnl-b feed-list">
              <div v-for="action in filteredFeed" :key="action._key" class="feed-item" :class="action.platform">
                <div class="feed-round font-mono">R{{ action.round }}</div>
                <div class="feed-av" :style="{ background: agentColor(action.agent_id) }">
                  {{ initials(action.agent_name) }}
                </div>
                <div class="feed-body">
                  <div class="feed-top">
                    <span class="feed-name">{{ action.agent_name }}</span>
                    <span class="feed-type font-mono" :class="'ft-' + (action.action_type || '').toLowerCase()">{{ (action.action_type || '').replace(/_/g, ' ').toLowerCase() }}</span>
                    <span class="feed-plat font-mono">{{ action.platform }}</span>
                  </div>
                  <div class="feed-content" v-if="action.content">{{ action.content }}</div>
                  <div class="feed-stats font-mono" v-if="action.stats">
                    <span v-if="action.stats.likes">&#9829; {{ action.stats.likes }}</span>
                    <span v-if="action.stats.reposts">&#8635; {{ action.stats.reposts }}</span>
                    <span v-if="action.stats.replies">&#9993; {{ action.stats.replies }}</span>
                    <span v-if="action.stats.upvotes">&#9650; {{ action.stats.upvotes }}</span>
                    <span v-if="action.stats.downvotes">&#9660; {{ action.stats.downvotes }}</span>
                  </div>
                </div>
              </div>
              <div v-if="filteredFeed.length === 0" class="feed-empty font-mono">No actions match filter</div>
            </div>
          </div>
        </section>

        <!-- Footer actions -->
        <div class="res-footer">
          <button class="btn-main" @click="router.push('/')">
            Run Another Simulation &rarr;
          </button>
        </div>
      </template>

      <!-- Error -->
      <template v-else-if="error">
        <div class="res-error">
          <div class="res-error-icon">!</div>
          <h2>Something went wrong</h2>
          <p>{{ error }}</p>
          <button class="btn-main" @click="loadResults">Retry</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, computed, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'

const CrowdScene = defineAsyncComponent(() => import('../components/CrowdScene.vue'))
import ScoreCards from '../components/ScoreCards.vue'
import FactionBreakdown from '../components/FactionBreakdown.vue'
import ReactionThemes from '../components/ReactionThemes.vue'
import StrategyPanel from '../components/StrategyPanel.vue'
import RewriteSuggestion from '../components/RewriteSuggestion.vue'
import InteractionGraph from '../components/InteractionGraph.vue'

const route = useRoute()
const router = useRouter()
const results = ref(null)
const abResults = ref({})
const isAB = ref(false)
const variantTexts = ref({})
const scenarioId = ref('')
const loading = ref(true)
const error = ref(null)
const originalPost = ref('')
const expandedAgent = ref(null)
const graphExpanded = ref(false)
const feedFilter = ref('all')

const variantIds = computed(() => isAB.value ? Object.keys(abResults.value).sort() : [])

const winner = computed(() => {
  if (!isAB.value || variantIds.value.length < 2) return null
  let best = null
  let bestScore = -Infinity
  for (const vid of variantIds.value) {
    const r = abResults.value[vid]
    if (!r) continue
    // Score: higher sentiment + lower risk + virality bonus
    const viralBonus = r.virality === 'high' ? 0.2 : r.virality === 'medium' ? 0.1 : 0
    const score = (r.sentiment_score || 0) - (r.risk_score || 5) * 0.1 + viralBonus
    if (score > bestScore) {
      bestScore = score
      best = vid
    }
  }
  if (!best) return null
  const r = abResults.value[best]
  return {
    id: best,
    reason: `Higher sentiment (${((r.sentiment_score || 0) * 100).toFixed(0)}%), lower risk (${r.risk_score}/10), ${r.virality} virality`
  }
})

const archColors = {
  supporter: '#059669', skeptic: '#dc2626', neutral: '#3b82f6',
  journalist: '#7c3aed', troll: '#f97316', influencer: '#d97706',
  expert: '#0891b2', casual_observer: '#6b7280'
}
const archColor = (arch) => archColors[arch?.toLowerCase()] || '#6b7280'
const initials = (name) => name ? name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?'
const sentClass = (v) => v > 0.2 ? 'pos' : v < -0.2 ? 'neg' : 'neut'
const fmtSent = (v) => v == null ? '0.00' : v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)

const actionColorMap = {
  CREATE_POST: '#7c3aed', CREATE_COMMENT: '#059669', COMMENT: '#059669',
  LIKE: '#ef4444', LIKE_POST: '#ef4444', LIKE_COMMENT: '#ef4444',
  REPOST: '#3b82f6', FOLLOW: '#0891b2', DO_NOTHING: '#9ca3af',
  UPVOTE_POST: '#f97316', DOWNVOTE_POST: '#6366f1',
}
const actionColor = (type) => actionColorMap[type] || '#6b7280'

const agentActionCounts = computed(() => {
  if (!results.value?.actions) return {}
  const counts = {}
  for (const a of results.value.actions) {
    if (a.agent_id !== undefined) counts[a.agent_id] = (counts[a.agent_id] || 0) + 1
  }
  return counts
})

const agentColor = (id) => {
  const agent = results.value?.agents?.find(a => a.agent_id === id)
  return archColor(agent?.archetype)
}

const archetypeBreakdown = computed(() => {
  if (!results.value?.agents) return []
  const counts = {}
  for (const a of results.value.agents) {
    const arch = a.archetype?.toLowerCase() || 'neutral'
    counts[arch] = (counts[arch] || 0) + 1
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})

const edgeCount = computed(() => {
  if (!results.value?.actions) return 0
  const links = new Set()
  const byRound = {}
  for (const a of results.value.actions) {
    const r = a.round || 0
    if (!byRound[r]) byRound[r] = []
    byRound[r].push(a)
  }
  for (const roundActions of Object.values(byRound)) {
    const commenting = roundActions.filter(a => ['CREATE_COMMENT', 'COMMENT', 'LIKE_COMMENT', 'LIKE_POST', 'REPOST'].includes(a.action_type))
    for (let i = 0; i < commenting.length; i++) {
      for (let j = i + 1; j < commenting.length; j++) {
        const a = commenting[i].agent_id, b = commenting[j].agent_id
        if (a !== undefined && b !== undefined && a !== b) links.add([Math.min(a, b), Math.max(a, b)].join('-'))
      }
    }
  }
  return links.size
})

const platformStats = computed(() => {
  if (!results.value?.actions) return []
  const plats = {}
  for (const a of results.value.actions) {
    const p = a.platform || 'unknown'
    if (!plats[p]) plats[p] = {}
    const t = a.action_type || 'UNKNOWN'
    plats[p][t] = (plats[p][t] || 0) + 1
  }
  return Object.entries(plats).map(([name, types]) => {
    const total = Object.values(types).reduce((s, c) => s + c, 0)
    const typeList = Object.entries(types).map(([type, count]) => ({ type, count, pct: Math.round(count / total * 100) })).sort((a, b) => b.count - a.count)
    return { name, total, types: typeList }
  })
})

const actionTypeDist = computed(() => {
  if (!results.value?.actions) return []
  const counts = {}
  for (const a of results.value.actions) {
    const t = a.action_type || 'UNKNOWN'
    counts[t] = (counts[t] || 0) + 1
  }
  const total = results.value.actions.length
  return Object.entries(counts).map(([type, count]) => ({ type, count, pct: Math.round(count / total * 100) })).sort((a, b) => b.count - a.count)
})

const filteredFeed = computed(() => {
  if (!results.value?.actions) return []
  let actions = results.value.actions.map((a, i) => ({ ...a, _key: `act-${i}` }))
  if (feedFilter.value === 'twitter') actions = actions.filter(a => a.platform === 'twitter')
  else if (feedFilter.value === 'reddit') actions = actions.filter(a => a.platform === 'reddit')
  else if (feedFilter.value === 'content') actions = actions.filter(a => a.content)
  return actions
})

async function loadResults() {
  loading.value = true
  error.value = null
  try {
    const { data } = await api.get(`/results/${route.params.id}`)

    // Detect A/B results: object with variant keys (A, B, ...) vs flat SimulationResults
    const keys = Object.keys(data)
    const looksAB = keys.length >= 2 && keys.every(k => /^[A-Z]$/.test(k)) && typeof data[keys[0]] === 'object' && data[keys[0]].sentiment_score !== undefined

    if (looksAB) {
      isAB.value = true
      abResults.value = data
      results.value = null // not used in A/B mode
    } else {
      isAB.value = false
      results.value = data
    }

    scenarioId.value = route.params.id
    try {
      const scenario = await api.get(`/scenarios/${route.params.id}`)
      originalPost.value = scenario.data.post_text || ''
      // Store variant texts for A/B display
      if (scenario.data.variants && scenario.data.variants.length > 1) {
        const vt = {}
        for (const v of scenario.data.variants) vt[v.id] = v.text
        variantTexts.value = vt
      }
    } catch {
      originalPost.value = '(original post not available)'
    }
  } catch (e) {
    error.value = e.response?.data?.detail || e.message || 'Failed to load results'
  } finally {
    loading.value = false
  }
}

async function handleRerun(rewriteText) {
  try {
    const { data: scenario } = await api.get(`/scenarios/${route.params.id}`)
    const { data: newScenario } = await api.post('/scenarios', {
      post_text: rewriteText,
      audience_desc: scenario.audience_desc,
      platforms: scenario.platforms,
      agent_count: scenario.agent_count,
      rounds: scenario.rounds
    })
    router.push(`/research/${newScenario.id}`)
  } catch (e) {
    console.error('Failed to create rerun scenario:', e)
  }
}

onMounted(loadResults)

watch(() => route.params.id, (newId, oldId) => {
  if (newId && newId !== oldId) loadResults()
})
</script>

<style scoped>
.results-view {
  height: 100%;
  overflow-y: auto;
  position: relative;
  z-index: 1;
}

.results-inner {
  position: relative;
  z-index: 1;
  max-width: 1280px;
  margin: 0 auto;
  padding: 18px 20px 40px;
}

/* Header */
.res-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  animation: fadeUp 0.3s ease-out both;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--header-surface-mix);
  box-shadow: var(--panel-shadow);
}

.res-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.res-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.res-badge {
  font-size: 10px;
  padding: 4px 10px;
  background: var(--panel-glass);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text2);
}

.btn-outline {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--blue);
  background: var(--panel-glass);
  transition: all 0.12s;
}

.btn-outline:hover {
  border-color: var(--border2);
  color: var(--text);
}

/* Original post */
.res-original {
  background: var(--blue-card);
  border: 1px solid var(--blue-border);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
  animation: fadeUp 0.3s ease-out both;
  animation-delay: 0.03s;
}

.res-orig-lbl {
  font-size: 9px;
  font-weight: 600;
  color: var(--text3);
  letter-spacing: 0.5px;
  display: block;
  margin-bottom: 4px;
}

.res-orig-text {
  font-size: 15px;
  line-height: 1.5;
  color: var(--text);
  font-style: italic;
}

/* Sections */
.res-section {
  margin-bottom: 12px;
}

.res-row {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}

.two-col { grid-template-columns: 1fr 1fr; }
.two-col-55 { grid-template-columns: 55fr 45fr; }

/* Graph container */
.graph-container {
  height: 440px;
  padding: 0;
  transition: height 0.3s ease;
}

.graph-container.expanded {
  height: 75vh;
}

.graph-container > * {
  height: 100%;
}

.graph-card-expanded {
  position: relative;
  z-index: 10;
}

.pnl-h-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.graph-toggle {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 3px;
  color: var(--blue);
  background: var(--blue-bg);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.12s;
  letter-spacing: 0.3px;
}

.graph-toggle:hover {
  border-color: var(--border2);
  color: var(--text2);
}

/* Agent Profiles */
.rp-arch-bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
  gap: 1px;
}

.rp-arch-seg {
  min-width: 3px;
}

.rp-arch-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-bottom: 12px;
}

.rp-arch-item {
  font-size: 9px;
  color: var(--text3);
  display: flex;
  align-items: center;
  gap: 3px;
  text-transform: capitalize;
}

.rp-arch-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.rp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.rp-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  transition: border-color 0.12s;
  cursor: pointer;
  background: var(--elevated-surface-soft);
}

.rp-card:hover { border-color: var(--border2); }
.rp-card.expanded { border-color: var(--green-border); box-shadow: 0 0 0 1px var(--green-border); }

.rp-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.rp-av {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.rp-info { flex: 1; min-width: 0; }
.rp-name { font-size: 13px; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-handle { font-size: 10px; color: var(--text3); }

.rp-arch-badge {
  font-size: 9px;
  font-weight: 600;
  text-transform: capitalize;
  flex-shrink: 0;
}

.rp-demo {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-bottom: 4px;
}

.rp-demo span {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--panel-glass);
  color: var(--text2);
}

.rp-metrics {
  display: flex;
  gap: 10px;
  margin-bottom: 6px;
}

.rp-m {
  display: flex;
  align-items: center;
  gap: 3px;
}

.rp-ml { font-size: 8px; color: var(--text3); font-weight: 600; }
.rp-mv { font-size: 10px; font-weight: 700; }
.rp-mv.pos { color: var(--green); }
.rp-mv.neg { color: var(--red); }
.rp-mv.neut { color: var(--text3); }

.rp-bio {
  font-size: 11px;
  color: var(--text2);
  line-height: 1.3;
  border-top: 1px solid var(--border);
  padding-top: 3px;
  margin-top: 2px;
}

.rp-expanded {
  border-top: 1px solid var(--border);
  padding-top: 6px;
  margin-top: 4px;
}

.rp-research {
  background: var(--amber-bg, #fffbeb);
  border: 1px solid var(--amber-border, #fde68a);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
}

.rp-research p {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text);
}

.rp-sub-lbl {
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.5px;
  display: block;
  margin-bottom: 3px;
}

.rp-research .rp-sub-lbl { color: var(--amber, #d97706); }
.rp-topics .rp-sub-lbl, .rp-persona .rp-sub-lbl { color: var(--text3); }

.rp-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.rp-tag {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--blue-bg);
  color: var(--blue, #3b82f6);
  border: 1px solid var(--blue-border, #bfdbfe);
}

.rp-topics { margin-bottom: 6px; }

.rp-persona p {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text2);
  max-height: 80px;
  overflow-y: auto;
}

/* Platform Breakdown */
.pb-row {
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.pb-row:last-child { border-bottom: none; }

.pb-plat {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 5px;
}

.pb-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.pb-dot.twitter { background: var(--blue, #1d9bf0); }
.pb-dot.reddit { background: var(--reddit, #dc2626); }

.pb-name { font-size: 10px; font-weight: 600; color: var(--text); }
.pb-total { font-size: 9px; color: var(--text3); }

.pb-bars {
  display: flex;
  height: 8px;
  border-radius: 3px;
  overflow: hidden;
  gap: 1px;
  margin-bottom: 4px;
}

.pb-bar {
  min-width: 2px;
  border-radius: 2px;
}

.pb-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 8px;
}

.pb-lg {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 8px;
  color: var(--text3);
}

.pb-lg-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
}

/* Action Distribution */
.ad-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
}

.ad-row:last-child { border-bottom: none; }

.ad-label {
  font-size: 10px;
  color: var(--text2);
  min-width: 80px;
  text-transform: lowercase;
}

.ad-track {
  flex: 1;
  height: 6px;
  background: var(--surface2);
  border-radius: 2px;
  overflow: hidden;
}

.ad-fill {
  height: 100%;
  border-radius: 2px;
}

.ad-val {
  font-size: 10px;
  font-weight: 600;
  color: var(--text3);
  min-width: 24px;
  text-align: right;
}

/* Feed */
.feed-controls {
  display: flex;
  gap: 3px;
}

.feed-filter {
  font-size: 9px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 999px;
  color: var(--text3);
  background: var(--surface);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.12s;
  letter-spacing: 0.3px;
}

.feed-filter:hover { border-color: var(--border2); color: var(--text2); }
.feed-filter.active { background: var(--green-bg); color: var(--green); border-color: var(--green-border); }

.feed-list {
  max-height: 500px;
  overflow-y: auto;
}

.feed-list::-webkit-scrollbar { width: 2px; }
.feed-list::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

.feed-item {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  align-items: flex-start;
  background: linear-gradient(90deg, var(--panel-glass), transparent);
}

.feed-item:last-child { border-bottom: none; }

.feed-item.twitter { border-left: 3px solid var(--blue, #1d9bf0); padding-left: 10px; }
.feed-item.reddit { border-left: 3px solid var(--reddit, #dc2626); padding-left: 10px; }

.feed-round {
  font-size: 9px;
  color: var(--text3);
  min-width: 20px;
  padding-top: 2px;
}

.feed-av {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.feed-body { flex: 1; min-width: 0; }

.feed-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.feed-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.feed-type {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--text3);
  font-weight: 600;
}

.ft-create_post { background: var(--purple-bg); color: var(--purple); }
.ft-comment, .ft-create_comment { background: var(--green-bg); color: var(--green); }
.ft-like, .ft-like_post, .ft-like_comment { background: var(--red-bg); color: var(--red); }
.ft-repost { background: var(--blue-bg); color: var(--blue); }

.feed-plat {
  font-size: 9px;
  color: var(--text3);
  margin-left: auto;
}

.feed-content {
  font-size: 13px;
  line-height: 1.45;
  color: var(--text2);
  margin-bottom: 4px;
}

.feed-stats {
  font-size: 9px;
  color: var(--text2);
  display: flex;
  gap: 8px;
}

.feed-empty {
  padding: 20px;
  text-align: center;
  font-size: 10px;
  color: var(--text3);
}

.res-footer {
  display: flex;
  justify-content: center;
  margin-top: 24px;
  animation: fadeUp 0.3s ease-out both;
  animation-delay: 0.2s;
}

/* Skeleton */
.skel {
  background: linear-gradient(90deg, var(--surface) 25%, var(--border) 50%, var(--surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skel-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 10px;
}

.skel-card { height: 90px; }

.skel-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}

.skel-panel { height: 200px; }

/* Error */
.res-error {
  text-align: center;
  padding: 60px 28px;
}

.res-error-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--red-bg);
  border: 1px solid var(--red-border);
  color: var(--red);
  font-size: 18px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 12px;
}

.res-error h2 {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 6px;
}

.res-error p {
  color: var(--text2);
  font-size: 12px;
  margin-bottom: 14px;
}

/* A/B Comparison */
.ab-badge {
  background: var(--purple-bg) !important;
  color: var(--purple) !important;
  border-color: var(--purple-border) !important;
}

.ab-posts {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}

.ab-post-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  border-top: 3px solid var(--border);
}

.ab-post-card.ab-a { border-top-color: var(--blue); }
.ab-post-card.ab-b { border-top-color: var(--purple); }
.ab-post-card.ab-c { border-top-color: var(--green); }
.ab-post-card.ab-d { border-top-color: var(--amber); }

.ab-post-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  display: block;
  margin-bottom: 4px;
}

.ab-a .ab-post-label { color: var(--blue); }
.ab-b .ab-post-label { color: var(--purple); }
.ab-c .ab-post-label { color: var(--green); }
.ab-d .ab-post-label { color: var(--amber); }

.ab-post-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  font-style: italic;
}

.ab-scores {
  display: grid;
  gap: 10px;
}

.ab-score-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ab-col-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 4px 10px;
  border-radius: 4px;
  text-align: center;
}

.ab-col-label.ab-a { background: var(--blue-bg); color: var(--blue); }
.ab-col-label.ab-b { background: var(--purple-bg); color: var(--purple); }
.ab-col-label.ab-c { background: var(--green-bg); color: var(--green); }
.ab-col-label.ab-d { background: var(--amber-bg, #fffbeb); color: var(--amber); }

.ab-compare-grid {
  display: grid;
  gap: 10px;
}

.ab-compare-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Winner banner */
.ab-winner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--green-bg);
  border: 1px solid var(--green-border);
  border-radius: 8px;
  margin-bottom: 14px;
}

.ab-winner-label {
  font-size: 8px;
  font-weight: 700;
  color: var(--green);
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border: 1px solid var(--green-border);
  border-radius: 3px;
  background: var(--white);
}

.ab-winner-id {
  font-size: 14px;
  font-weight: 700;
}

.ab-winner-id.ab-a { color: var(--blue); }
.ab-winner-id.ab-b { color: var(--purple); }
.ab-winner-id.ab-c { color: var(--green); }

.ab-winner-reason {
  font-size: 12px;
  color: var(--text2);
}

/* Verdict comparison */
.ab-verdicts {
  display: grid;
  gap: 10px;
}

.ab-verdict {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  border-top: 2px solid var(--border);
}

.ab-verdict.ab-a { border-top-color: var(--blue); }
.ab-verdict.ab-b { border-top-color: var(--purple); }
.ab-verdict.ab-c { border-top-color: var(--green); }

.ab-verdict-header {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.ab-a .ab-verdict-header { color: var(--blue); }
.ab-b .ab-verdict-header { color: var(--purple); }
.ab-c .ab-verdict-header { color: var(--green); }

.ab-verdict-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
  margin-bottom: 8px;
}

.ab-verdict-rewrite {
  background: var(--surface);
  border-radius: 4px;
  padding: 6px 8px;
}

.ab-verdict-rl {
  font-size: 7px;
  font-weight: 600;
  color: var(--text3);
  letter-spacing: 0.5px;
  display: block;
  margin-bottom: 3px;
}

.ab-verdict-rewrite p {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text2);
  font-style: italic;
}

@media (max-width: 900px) {
  .two-col, .two-col-55 { grid-template-columns: 1fr; }
  .rp-grid { grid-template-columns: 1fr; }
  .skel-grid { grid-template-columns: 1fr 1fr; }
  .res-head { flex-direction: column; align-items: flex-start; gap: 8px; }
  .ab-posts, .ab-scores, .ab-compare-grid, .ab-verdicts { grid-template-columns: 1fr !important; }
}
</style>

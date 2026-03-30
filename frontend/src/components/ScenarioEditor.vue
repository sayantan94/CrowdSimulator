<template>
  <div class="editor">
    <div class="ed-split">
      <!-- Left pane: Post content -->
      <div class="ed-left">
        <div class="ed-section-head">
          <span class="ed-label">{{ abMode ? 'Variants' : 'Post' }}</span>
          <div class="ed-head-actions">
            <button class="ed-mode-btn" :class="{ active: abMode }" @click="toggleAB">
              <span class="ed-mode-icon">{{ abMode ? '&#9635;' : '&#9634;' }}</span>
              A/B Test
            </button>
            <div class="ed-size-toggle" v-if="!abMode">
              <button
                v-for="s in postSizes"
                :key="s.id"
                class="size-opt"
                :class="{ active: postSize === s.id }"
                @click="postSize = s.id"
              >{{ s.label }}</button>
            </div>
            <span class="post-count" v-if="!abMode">{{ postText.length }}/2000</span>
          </div>
        </div>

        <!-- Single post mode -->
        <div class="ed-post-wrap" v-if="!abMode">
          <textarea
            v-model="postText"
            class="post-input"
            :style="{ fontSize: postFontSize }"
            placeholder="Paste your post draft here..."
            maxlength="2000"
          ></textarea>
        </div>

        <!-- A/B variant mode -->
        <div class="ed-variants" v-else>
          <div
            v-for="(v, i) in variants"
            :key="v.id"
            class="ed-variant"
            :class="'variant-' + v.id.toLowerCase()"
          >
            <div class="ev-head">
              <span class="ev-marker">{{ v.id }}</span>
              <span class="ev-count">{{ v.text.length }}/2000</span>
              <button
                v-if="variants.length > 2"
                class="ev-remove"
                @click="removeVariant(i)"
                title="Remove variant"
              >&times;</button>
            </div>
            <textarea
              v-model="v.text"
              class="ev-input"
              :placeholder="i === 0 ? 'Paste your first variant...' : 'Paste an alternative version...'"
              maxlength="2000"
            ></textarea>
          </div>
          <button
            v-if="variants.length < 4"
            class="ev-add"
            @click="addVariant"
          >+ Add Variant {{ String.fromCharCode(65 + variants.length) }}</button>
        </div>
      </div>

      <!-- Right pane: Configuration -->
      <div class="ed-right">
        <div class="ed-section-head">
          <span class="ed-label">Settings</span>
        </div>

        <div class="ed-right-scroll">
          <!-- Simulation Mode -->
          <div class="ed-field">
            <label class="field-label">Simulation Mode</label>
            <div class="ed-mode-toggle">
              <button
                class="mode-opt"
                :class="{ active: simMode === 'normal' }"
                @click="simMode = 'normal'"
              >Normal</button>
              <button
                class="mode-opt"
                :class="{ active: simMode === 'gstack' }"
                @click="simMode = 'gstack'"
              >gstack Team</button>
            </div>
            <div class="gs-path-row" v-if="simMode === 'gstack'">
              <input
                v-model="gstackPath"
                class="gs-path-input"
                placeholder="Path to gstack directory"
                spellcheck="false"
                @keydown.enter.prevent="reloadGstack"
              />
              <button class="gs-path-reload" @click="reloadGstack" :disabled="gstackLoading">
                {{ gstackLoading ? '...' : 'Reload' }}
              </button>
            </div>
          </div>

          <!-- gstack Setup Required -->
          <div class="ed-field" v-if="simMode === 'gstack' && !gstackAvailable">
            <div class="gs-setup">
              <div class="gs-setup-icon">&#9881;</div>
              <div class="gs-setup-title">gstack not found</div>
              <p class="gs-setup-desc">Clone the gstack repo to enable team personas:</p>
              <code class="gs-setup-cmd">git clone https://github.com/garry/gstack.git \<br/>{{ gstackPath || '~/Documents/Workspace/personal-assist/gstack' }}</code>
              <div class="gs-setup-tree">
                <div class="gs-tree-label">Expected structure:</div>
                <pre class="gs-tree">{{ gstackPath || 'gstack' }}/
├── plan-ceo-review/
│   └── SKILL.md
├── office-hours/
│   └── SKILL.md
├── review/
│   └── SKILL.md
├── qa/
│   └── SKILL.md
├── cso/
│   └── SKILL.md
└── ...</pre>
              </div>
              <p class="gs-setup-hint">Set <code>GSTACK_DIR</code> env var to use a custom path.</p>
            </div>
          </div>

          <!-- gstack Persona Picker -->
          <div class="ed-field" v-if="simMode === 'gstack' && gstackAvailable">
            <div class="field-label-row">
              <label class="field-label">Team Personas</label>
              <button class="gs-select-all" @click="selectAllPersonas">
                {{ selectedPersonas.length === gstackPersonas.length ? 'Deselect all' : 'Select all' }}
              </button>
            </div>
            <div class="gs-grid">
              <div
                v-for="p in gstackPersonas"
                :key="p.skill_name"
                class="gs-persona-wrap"
                :class="{ active: personaConfig[p.skill_name]?.count > 0 }"
              >
                <button
                  class="gs-persona-row"
                  @click="togglePersona(p.skill_name)"
                >
                  <span class="gs-check">{{ personaConfig[p.skill_name]?.count > 0 ? '&#10003;' : '' }}</span>
                  <span class="gs-name">{{ p.display_name }}</span>
                  <span class="gs-arch">{{ p.archetype }}</span>
                </button>

                <!-- Expanded controls (visible when selected) -->
                <div class="gs-controls" v-if="personaConfig[p.skill_name]?.count > 0">
                  <div class="gs-source">{{ p.folder_name }}/SKILL.md</div>

                  <!-- Multiplier stepper -->
                  <div class="gs-stepper-row">
                    <span class="gs-ctrl-label">count</span>
                    <div class="gs-stepper">
                      <button class="gs-step-btn" @click.stop="adjustCount(p.skill_name, -1)" :disabled="personaConfig[p.skill_name].count <= 1">&minus;</button>
                      <span class="gs-step-val">{{ personaConfig[p.skill_name].count }}</span>
                      <button class="gs-step-btn" @click.stop="adjustCount(p.skill_name, 1)" :disabled="personaConfig[p.skill_name].count >= 10">+</button>
                    </div>
                  </div>

                  <!-- Sentiment bias slider -->
                  <div class="gs-slider-row">
                    <span class="gs-ctrl-label">sentiment</span>
                    <input
                      type="range"
                      class="gs-slider"
                      min="-1" max="1" step="0.1"
                      :value="personaConfig[p.skill_name].sentiment_bias"
                      @input="personaConfig[p.skill_name].sentiment_bias = parseFloat($event.target.value)"
                      @click.stop
                    />
                    <span class="gs-slider-val">{{ personaConfig[p.skill_name].sentiment_bias.toFixed(1) }}</span>
                  </div>

                  <!-- Influence weight slider -->
                  <div class="gs-slider-row">
                    <span class="gs-ctrl-label">influence</span>
                    <input
                      type="range"
                      class="gs-slider"
                      min="0.5" max="5" step="0.5"
                      :value="personaConfig[p.skill_name].influence_weight"
                      @input="personaConfig[p.skill_name].influence_weight = parseFloat($event.target.value)"
                      @click.stop
                    />
                    <span class="gs-slider-val">{{ personaConfig[p.skill_name].influence_weight.toFixed(1) }}</span>
                  </div>

                  <!-- Activity level slider -->
                  <div class="gs-slider-row">
                    <span class="gs-ctrl-label">activity</span>
                    <input
                      type="range"
                      class="gs-slider"
                      min="0.1" max="1" step="0.1"
                      :value="personaConfig[p.skill_name].activity_level"
                      @input="personaConfig[p.skill_name].activity_level = parseFloat($event.target.value)"
                      @click.stop
                    />
                    <span class="gs-slider-val">{{ personaConfig[p.skill_name].activity_level.toFixed(1) }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="gs-count">{{ selectedPersonas.length }} personas · {{ totalGstackAgents }} agents total</div>
          </div>

          <!-- Models -->
          <div class="ed-field">
            <label class="field-label">LLM Model</label>
            <div class="model-input-wrap">
              <input
                v-model="modelInput"
                class="model-input"
                placeholder="openrouter model id"
                spellcheck="false"
              />
            </div>
            <label class="field-label" style="margin-top:12px">Search Model</label>
            <div class="model-input-wrap">
              <input
                v-model="searchModelInput"
                class="model-input"
                placeholder="openrouter search model id"
                spellcheck="false"
              />
            </div>
            <a class="model-browse" href="https://openrouter.ai/models" target="_blank" rel="noopener">Browse models &#8599;</a>
          </div>

          <!-- Audience -->
          <div class="ed-field">
            <label class="field-label">Target Audience</label>
            <textarea
              ref="audienceTextarea"
              v-model="audienceDesc"
              class="aud-input"
              placeholder="Who is this for?"
              rows="3"
            ></textarea>
            <AudienceChips @select="onChipSelect" />
          </div>

          <!-- Research Focus -->
          <div class="ed-field">
            <label class="field-label">Research Focus</label>
            <p class="rf-desc">Keep only the angles that matter.</p>

            <!-- Default research angles -->
            <div class="rf-defaults">
              <button
                v-for="angle in defaultAngles"
                :key="angle.id"
                class="rf-chip"
                :class="{ active: activeAngles.includes(angle.id) }"
                @click="toggleAngle(angle.id)"
              >
                <span class="rf-chip-check">{{ activeAngles.includes(angle.id) ? '&#10003;' : '' }}</span>
                {{ angle.label }}
              </button>
            </div>

            <!-- Custom topics -->
            <div class="rf-custom" v-if="customTopics.length > 0">
              <div class="rf-custom-list">
                <span
                  v-for="(topic, i) in customTopics"
                  :key="i"
                  class="rf-tag"
                >
                  {{ topic }}
                  <button class="rf-tag-x" @click="customTopics.splice(i, 1)">&times;</button>
                </span>
              </div>
            </div>

            <!-- Add custom topic -->
            <div class="rf-add-row">
              <input
                v-model="newTopic"
                class="rf-add-input"
                placeholder="Add custom topic"
                @keydown.enter.prevent="addTopic"
              />
              <button class="rf-add-btn" @click="addTopic" :disabled="!newTopic.trim()">Add</button>
            </div>
          </div>

          <!-- Platforms -->
          <div class="ed-field">
            <label class="field-label">Platforms</label>
            <div class="ed-plats">
              <button
                v-for="p in platformOptions"
                :key="p.value"
                class="plat-btn"
                :class="[p.cls, { active: platforms.includes(p.value) }]"
                @click="togglePlatform(p.value)"
              >
                <span class="plat-icon">{{ p.icon }}</span>
                {{ p.label }}
              </button>
            </div>
          </div>

          <!-- Agents + Rounds -->
          <div class="ed-field">
            <div class="ed-config-row">
              <div class="cfg-group" v-if="simMode !== 'gstack'">
                <label class="field-label">Agents</label>
                <div class="cfg-input-row">
                  <input
                    v-model.number="agentCount"
                    type="number"
                    min="5"
                    max="1000000"
                    class="cfg-num-input"
                  />
                  <div class="cfg-presets">
                    <button
                      v-for="n in agentPresets"
                      :key="n"
                      class="cfg-preset"
                      :class="{ active: agentCount === n }"
                      @click="agentCount = n"
                    >{{ formatNum(n) }}</button>
                  </div>
                </div>
              </div>
              <div class="cfg-group">
                <label class="field-label">Rounds</label>
                <div class="cfg-input-row">
                  <input
                    v-model.number="rounds"
                    type="number"
                    min="1"
                    max="100"
                    class="cfg-num-input"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom: submit -->
    <div class="ed-bottom">
      <div class="ed-bottom-info" v-if="canSubmit">
        <template v-if="simMode === 'gstack'">
          {{ selectedPersonas.length }} personas ({{ totalGstackAgents }} agents) · {{ rounds }} rounds · {{ platforms.join(' + ') }}{{ abMode ? ` · ${variants.length} variants` : '' }}
        </template>
        <template v-else>
          {{ agentCount }} agents · {{ rounds }} rounds · {{ platforms.join(' + ') }}{{ abMode ? ` · ${variants.length} variants` : '' }}
        </template>
      </div>
      <button class="ed-submit" :disabled="!canSubmit" @click="handleSubmit">
        <span class="ed-submit-text">Simulate Crowd Reaction</span>
        <span class="ed-submit-arrow">&rarr;</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { fetchGstackPersonas, reloadGstackPersonas } from '../api'
import AudienceChips from './AudienceChips.vue'

const emit = defineEmits(['submit'])

const postText = ref('')
const audienceDesc = ref('')
const platforms = ref(['twitter', 'reddit'])
const agentCount = ref(15)
const rounds = ref(5)
const audienceTextarea = ref(null)
const abMode = ref(false)
const variants = ref([
  { id: 'A', text: '' },
  { id: 'B', text: '' },
])

// Research focus
const newTopic = ref('')
const customTopics = ref([])

const defaultAngles = [
  { id: 'sentiment', label: 'Sentiment & discourse', icon: '~' },
  { id: 'news', label: 'News & events', icon: '!' },
  { id: 'demographics', label: 'Audience demographics', icon: '#' },
  { id: 'controversy', label: 'Controversy & risks', icon: '*' },
  { id: 'competitors', label: 'Similar posts', icon: '=' },
  { id: 'culture', label: 'Cultural context', icon: '@' },
  { id: 'platform', label: 'Platform patterns', icon: '>' },
]

const activeAngles = ref(defaultAngles.map(a => a.id))

// Model selection — user types any OpenRouter model ID
const modelInput = ref('x-ai/grok-4.1-fast')
const searchModelInput = ref('perplexity/sonar')

// gstack mode
const simMode = ref('normal')
const gstackPersonas = ref([])
const personaConfig = ref({})   // Map<skill_name, { count, sentiment_bias, influence_weight, activity_level }>
const gstackLoading = ref(false)
const gstackAvailable = ref(false)
const gstackPath = ref('')

// Computed: list of selected skill_names (those with count >= 1 in personaConfig)
const selectedPersonas = computed(() =>
  Object.entries(personaConfig.value)
    .filter(([, cfg]) => cfg.count > 0)
    .map(([name]) => name)
)

// Computed: total agent count across all selected personas
const totalGstackAgents = computed(() =>
  Object.values(personaConfig.value)
    .reduce((sum, cfg) => sum + (cfg.count > 0 ? cfg.count : 0), 0)
)

onMounted(async () => {
  try {
    gstackLoading.value = true
    const data = await fetchGstackPersonas()
    gstackAvailable.value = data.available
    gstackPath.value = data.path || ''
    gstackPersonas.value = data.personas || []
    // Initialize config with defaults (count=0 means not selected)
    const cfg = {}
    for (const p of gstackPersonas.value) {
      cfg[p.skill_name] = {
        count: 0,
        sentiment_bias: p.sentiment_bias,
        influence_weight: p.influence_weight,
        activity_level: p.activity_level,
      }
    }
    personaConfig.value = cfg
  } catch {
    // gstack not available
  } finally {
    gstackLoading.value = false
  }
})

async function reloadGstack() {
  try {
    gstackLoading.value = true
    const data = await reloadGstackPersonas(gstackPath.value)
    gstackAvailable.value = data.available
    gstackPath.value = data.path || ''
    gstackPersonas.value = data.personas || []
    // Re-initialize config, preserving counts for personas that still exist
    const oldCfg = personaConfig.value
    const cfg = {}
    for (const p of gstackPersonas.value) {
      cfg[p.skill_name] = oldCfg[p.skill_name] || {
        count: 0,
        sentiment_bias: p.sentiment_bias,
        influence_weight: p.influence_weight,
        activity_level: p.activity_level,
      }
    }
    personaConfig.value = cfg
  } catch (err) {
    console.error('Failed to reload gstack:', err)
  } finally {
    gstackLoading.value = false
  }
}

function togglePersona(skillName) {
  const cfg = personaConfig.value[skillName]
  if (!cfg) return
  cfg.count = cfg.count > 0 ? 0 : 1
}

function selectAllPersonas() {
  const allSelected = selectedPersonas.value.length === gstackPersonas.value.length
  for (const p of gstackPersonas.value) {
    personaConfig.value[p.skill_name].count = allSelected ? 0 : 1
  }
}

function adjustCount(skillName, delta) {
  const cfg = personaConfig.value[skillName]
  if (!cfg) return
  cfg.count = Math.max(1, Math.min(10, cfg.count + delta))
}

// Post font size
const postSize = ref('large')
const postSizes = [
  { id: 'small', label: 'S', css: '16px' },
  { id: 'medium', label: 'M', css: '22px' },
  { id: 'large', label: 'L', css: 'clamp(26px, 2.6vw, 38px)' },
]
const postFontSize = computed(() => postSizes.find(s => s.id === postSize.value)?.css || '22px')

const agentPresets = [15, 50, 200, 1000, 10000]

const platformOptions = [
  { value: 'twitter', label: 'Twitter', cls: 'tw', icon: '𝕏' },
  { value: 'reddit', label: 'Reddit', cls: 'rd', icon: 'r/' }
]

const canSubmit = computed(() => {
  if (platforms.value.length === 0) return false
  if (simMode.value === 'gstack' && selectedPersonas.value.length === 0) return false
  if (abMode.value) {
    return variants.value.every(v => v.text.trim().length > 0)
  }
  return postText.value.trim().length > 0
})

const formatNum = (n) => {
  if (n >= 1000) return (n / 1000) + 'K'
  return String(n)
}

function togglePlatform(value) {
  const idx = platforms.value.indexOf(value)
  if (idx >= 0) {
    if (platforms.value.length > 1) platforms.value.splice(idx, 1)
  } else {
    platforms.value.push(value)
  }
}

function onChipSelect(description) {
  audienceDesc.value = description
  if (audienceTextarea.value) audienceTextarea.value.focus()
}

function toggleAB() {
  abMode.value = !abMode.value
  if (abMode.value && postText.value.trim()) {
    variants.value[0].text = postText.value
  }
}

function addVariant() {
  const nextId = String.fromCharCode(65 + variants.value.length)
  variants.value.push({ id: nextId, text: '' })
}

function removeVariant(index) {
  variants.value.splice(index, 1)
  variants.value.forEach((v, i) => { v.id = String.fromCharCode(65 + i) })
}

function toggleAngle(id) {
  const idx = activeAngles.value.indexOf(id)
  if (idx >= 0) {
    activeAngles.value.splice(idx, 1)
  } else {
    activeAngles.value.push(id)
  }
}

function addTopic() {
  const t = newTopic.value.trim()
  if (t && !customTopics.value.includes(t)) {
    customTopics.value.push(t)
    newTopic.value = ''
  }
}

function buildResearchTopics() {
  const topics = []

  // Map active default angles to descriptive strings
  const angleDescriptions = {
    sentiment: 'Topic sentiment and current public discourse',
    news: 'Breaking news and recent events',
    demographics: 'Audience demographics and communities',
    controversy: 'Controversy, backlash history, and risks',
    competitors: 'Similar posts that went viral or failed',
    culture: 'Cultural context, memes, community norms',
    platform: 'Platform-specific patterns (Twitter vs Reddit)',
  }

  for (const id of activeAngles.value) {
    if (angleDescriptions[id]) topics.push(angleDescriptions[id])
  }

  // Add custom topics
  for (const t of customTopics.value) {
    topics.push(t)
  }

  return topics
}

function handleSubmit() {
  if (!canSubmit.value) return
  const payload = {
    audience_desc: audienceDesc.value.trim(),
    platforms: [...platforms.value],
    agent_count: agentCount.value,
    rounds: rounds.value,
    research_topics: buildResearchTopics(),
    model: modelInput.value.trim() || undefined,
    search_model: searchModelInput.value.trim() || undefined,
    mode: simMode.value,
    ...(simMode.value === 'gstack' ? {
      gstack_personas: selectedPersonas.value.map(name => ({
        skill_name: name,
        ...personaConfig.value[name],
      })),
      agent_count: totalGstackAgents.value,
    } : {}),
  }
  if (abMode.value) {
    payload.variants = variants.value.map(v => ({ id: v.id, text: v.text.trim() }))
    payload.post_text = variants.value[0].text.trim()
  } else {
    payload.post_text = postText.value.trim()
  }
  emit('submit', payload)
}
</script>

<style scoped>
.editor {
  background: var(--elevated-surface);
  border: 1px solid var(--border);
  border-radius: 22px;
  overflow: hidden;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-shadow: var(--panel-shadow);
}

/* Split layout */
.ed-split {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(300px, 360px);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.ed-left {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--border);
  background: var(--blue-card);
  min-width: 0;
}

.ed-right {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--elevated-surface-soft);
  min-width: 0;
}

.ed-right-scroll {
  flex: 1;
  overflow-y: auto;
}

.ed-right-scroll::-webkit-scrollbar { width: 3px; }
.ed-right-scroll::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

/* Section headers */
.ed-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--header-surface-mix);
  flex-shrink: 0;
}

.ed-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}

.ed-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* A/B toggle */
.ed-mode-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text2);
  background: var(--panel-glass);
  cursor: pointer;
  transition: all 0.15s;
}

.ed-mode-btn:hover {
  border-color: var(--border2);
  color: var(--text2);
}

.ed-mode-btn.active {
  background: var(--blue-bg);
  color: var(--blue);
  border-color: var(--blue-border);
  font-weight: 600;
}

.ed-mode-icon {
  font-size: 12px;
  line-height: 1;
}

/* Field groups */
.ed-field {
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.ed-field:last-child {
  border-bottom: none;
}

.field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text2);
  letter-spacing: -0.01em;
  margin-bottom: 8px;
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.field-label-row .field-label {
  margin-bottom: 0;
}

/* Post textarea */
.ed-post-wrap {
  flex: 1;
  display: flex;
}

.post-input {
  width: 100%;
  padding: 38px 40px 30px;
  border: none;
  background: transparent;
  font-size: clamp(26px, 2.6vw, 38px);
  line-height: 1.28;
  color: var(--text);
  resize: none;
  outline: none;
  font-family: var(--sans);
  font-weight: 600;
  letter-spacing: -0.04em;
}

.post-input::placeholder { color: var(--text2); }

.post-count {
  font-size: 11px;
  color: var(--text3);
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--blue-bg);
  border: 1px solid var(--blue-border);
}

/* Audience */
.aud-input {
  width: 100%;
  padding: 12px 14px;
  background: var(--panel-glass);
  border: 1px solid var(--border);
  border-radius: 14px;
  font-size: 13px;
  color: var(--text2);
  resize: none;
  outline: none;
  font-family: var(--sans);
  line-height: 1.4;
  transition: border-color 0.12s;
}

.aud-input:focus { border-color: var(--border2); }
.aud-input::placeholder { color: var(--text3); }

/* Research Focus */
.rf-desc {
  font-size: 11px;
  color: var(--text3);
  margin-bottom: 10px;
  line-height: 1.4;
}

.rf-defaults {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rf-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--border);
  color: var(--text2);
  background: var(--panel-glass);
  cursor: pointer;
  transition: all 0.12s;
}

.rf-chip:hover { border-color: var(--border2); color: var(--text2); }

.rf-chip.active {
  background: var(--green-bg);
  color: var(--green);
  border-color: var(--green-border);
}

.rf-chip-check {
  font-size: 8px;
  width: 10px;
  text-align: center;
}

.rf-custom-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.rf-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  background: var(--blue-bg);
  color: var(--blue);
  border: 1px solid var(--blue-border);
}

.rf-tag-x {
  font-size: 11px;
  line-height: 1;
  color: var(--blue);
  opacity: 0.5;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.rf-tag-x:hover { opacity: 1; }

.rf-add-row {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.rf-add-input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 12px;
  color: var(--text);
  background: var(--panel-glass);
  outline: none;
  transition: border-color 0.12s;
}

.rf-add-input:focus { border-color: var(--border2); }
.rf-add-input::placeholder { color: var(--text3); }

.rf-add-btn {
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text2);
  background: var(--panel-glass);
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}

.rf-add-btn:hover:not(:disabled) { border-color: var(--border2); color: var(--text); }
.rf-add-btn:disabled { opacity: 0.3; cursor: not-allowed; }

/* Model input */
.model-input-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--panel-glass);
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  font-family: var(--mono, monospace);
  color: var(--text);
  outline: none;
  transition: border-color 0.12s;
}

.model-input:focus { border-color: var(--border2); }
.model-input::placeholder { color: var(--text3); }

.model-browse {
  font-size: 10px;
  color: var(--text3);
  text-decoration: none;
  transition: color 0.12s;
  align-self: flex-end;
}

.model-browse:hover { color: var(--blue); }

/* Platforms */
.ed-plats { display: flex; gap: 8px; }

.plat-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border);
  color: var(--text2);
  background: var(--panel-glass);
  transition: all 0.12s;
}

.plat-icon {
  font-size: 11px;
  font-weight: 700;
}

.plat-btn.tw.active {
  border-color: var(--blue);
  color: var(--blue);
  background: var(--blue-bg);
}

.plat-btn.rd.active {
  border-color: var(--red);
  color: var(--red);
  background: var(--red-bg);
}

.plat-btn:not(.active):hover {
  border-color: var(--border2);
  color: var(--text2);
}

/* Config row */
.ed-config-row {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  justify-content: space-between;
}

.cfg-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cfg-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cfg-num-input {
  width: 78px;
  padding: 10px 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  background: var(--panel-glass);
  text-align: center;
  transition: border-color 0.12s;
}

.cfg-num-input:focus { border-color: var(--border2); }

.cfg-num-input::-webkit-outer-spin-button,
.cfg-num-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.cfg-num-input[type=number] { -moz-appearance: textfield; }

.cfg-presets {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.cfg-preset {
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--border);
  color: var(--text2);
  background: var(--panel-glass);
  cursor: pointer;
  transition: all 0.12s;
  letter-spacing: -0.01em;
}

.cfg-preset:hover {
  border-color: var(--border2);
  color: var(--text2);
}

.cfg-preset.active {
  border-color: var(--green);
  color: var(--green);
  background: var(--green-bg);
}

/* Variants */
.ed-variants {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.ed-variant {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 100px;
  border-bottom: 1px solid var(--border);
}

.ed-variant:last-of-type {
  border-bottom: none;
}

.ev-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  background: var(--header-surface);
  border-bottom: 1px solid var(--border);
}

.ev-marker {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
}

.variant-a .ev-marker { background: var(--blue-bg); color: var(--blue); }
.variant-b .ev-marker { background: var(--purple-bg); color: var(--purple); }
.variant-c .ev-marker { background: var(--green-bg); color: var(--green); }
.variant-d .ev-marker { background: var(--amber-bg, #fffbeb); color: var(--amber); }

.variant-a { border-left: 2px solid var(--blue); }
.variant-b { border-left: 2px solid var(--purple); }
.variant-c { border-left: 2px solid var(--green); }
.variant-d { border-left: 2px solid var(--amber); }

.ev-count {
  font-size: 11px;
  color: var(--text3);
  margin-left: auto;
}

.ev-remove {
  font-size: 14px;
  line-height: 1;
  color: var(--text3);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0.5;
  transition: opacity 0.12s;
}

.ev-remove:hover { opacity: 1; color: var(--red); }

.ev-input {
  flex: 1;
  width: 100%;
  padding: 18px 18px 16px;
  border: none;
  background: transparent;
  font-size: 18px;
  line-height: 1.45;
  color: var(--text);
  resize: none;
  outline: none;
  font-family: var(--sans);
  min-height: 90px;
  letter-spacing: -0.02em;
}

.ev-input::placeholder { color: var(--text3); }

.ev-add {
  font-size: 12px;
  font-weight: 500;
  padding: 10px 14px;
  color: var(--text3);
  background: var(--surface);
  border: none;
  border-top: 1px solid var(--border);
  cursor: pointer;
  text-align: left;
  transition: all 0.12s;
}

.ev-add:hover {
  color: var(--text2);
  background: var(--panel-glass);
}

/* Bottom bar */
.ed-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
  background: var(--header-surface-warm);
  gap: 12px;
}

.ed-bottom-info {
  font-size: 12px;
  color: var(--text3);
  letter-spacing: -0.01em;
}

.ed-submit {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 22px;
  background: linear-gradient(135deg, var(--blue), var(--purple));
  color: #fff;
  border: none;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--sans);
  white-space: nowrap;
  flex-shrink: 0;
}

.ed-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--panel-shadow-soft);
}

.ed-submit:active:not(:disabled) {
  transform: translateY(0);
}

.ed-submit:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  transform: none;
}

.ed-submit-arrow {
  font-size: 15px;
  transition: transform 0.15s;
}

.ed-submit:hover:not(:disabled) .ed-submit-arrow {
  transform: translateX(2px);
}


@media (max-width: 768px) {
  .ed-split {
    grid-template-columns: 1fr;
  }
  .ed-left {
    border-right: none;
    border-bottom: 1px solid var(--border);
    min-height: 200px;
  }
  .ed-post-wrap {
    min-height: 150px;
  }
  .post-input {
    padding: 24px 20px 20px;
    font-size: 20px;
  }
  .cfg-presets { display: none; }
  .ed-bottom-info { display: none; }
}

/* Mode toggle */
.ed-mode-toggle {
  display: flex;
  gap: 4px;
  background: var(--panel-glass);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 3px;
}

.mode-opt {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text3);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.mode-opt.active {
  background: var(--elevated-surface);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.mode-opt:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* gstack persona picker */
.gs-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}


.gs-check {
  width: 14px;
  font-size: 10px;
  color: var(--green);
  flex-shrink: 0;
}

.gs-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
}

.gs-arch {
  font-size: 10px;
  color: var(--text3);
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.gs-count {
  font-size: 11px;
  color: var(--text3);
  margin-top: 6px;
}

.gs-select-all {
  font-size: 10px;
  color: var(--text3);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

.gs-select-all:hover {
  color: var(--text2);
}

/* Post size toggle */
.ed-size-toggle {
  display: flex;
  gap: 2px;
  background: var(--panel-glass);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 2px;
}

.size-opt {
  width: 26px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text3);
  background: transparent;
  cursor: pointer;
  transition: all 0.12s;
}

.size-opt.active {
  background: var(--elevated-surface);
  color: var(--text);
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}

.size-opt:hover:not(.active) {
  color: var(--text2);
}

/* gstack setup */
.gs-setup {
  padding: 16px;
  border-radius: 12px;
  border: 1px dashed var(--border2);
  background: var(--panel-glass);
  text-align: center;
}

.gs-setup-icon {
  font-size: 24px;
  margin-bottom: 8px;
  opacity: 0.5;
}

.gs-setup-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 6px;
}

.gs-setup-desc {
  font-size: 11px;
  color: var(--text2);
  margin-bottom: 10px;
  line-height: 1.4;
}

.gs-setup-cmd {
  display: block;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  font-family: var(--mono, monospace);
  font-size: 11px;
  color: var(--text);
  text-align: left;
  line-height: 1.5;
  word-break: break-all;
  margin-bottom: 12px;
}

.gs-setup-tree {
  text-align: left;
  margin-bottom: 10px;
}

.gs-tree-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text3);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.gs-tree {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  font-family: var(--mono, monospace);
  font-size: 10px;
  color: var(--text2);
  line-height: 1.5;
  margin: 0;
  overflow-x: auto;
}

.gs-setup-hint {
  font-size: 10px;
  color: var(--text3);
  line-height: 1.4;
}

.gs-setup-hint code {
  font-family: var(--mono, monospace);
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface);
  border: 1px solid var(--border);
}

/* gstack path override */
.gs-path-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  align-items: center;
}

.gs-path-input {
  flex: 1;
  padding: 6px 8px;
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: var(--text2);
  background: var(--panel-glass);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.12s;
}

.gs-path-input:focus {
  border-color: var(--border2);
}

.gs-path-input::placeholder {
  color: var(--text3);
}

.gs-path-reload {
  padding: 5px 10px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text2);
  background: var(--panel-glass);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}

.gs-path-reload:hover:not(:disabled) {
  border-color: var(--border2);
  color: var(--text);
}

.gs-path-reload:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Persona wrap — replaces gs-persona button as container */
.gs-persona-wrap {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-glass);
  transition: all 0.12s;
  overflow: hidden;
}

.gs-persona-wrap:hover {
  border-color: var(--border2);
}

.gs-persona-wrap.active {
  border-color: var(--green-border);
  background: var(--green-bg);
}

.gs-persona-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  width: 100%;
  background: none;
  border: none;
  font: inherit;
  color: inherit;
}

/* Expanded controls area */
.gs-controls {
  padding: 6px 12px 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gs-source {
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: var(--text3);
  margin-bottom: 2px;
}

/* Stepper row */
.gs-stepper-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gs-ctrl-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text3);
  width: 58px;
  flex-shrink: 0;
}

.gs-stepper {
  display: flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.gs-step-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--panel-glass);
  color: var(--text2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.1s;
}

.gs-step-btn:hover:not(:disabled) {
  background: var(--elevated-surface);
}

.gs-step-btn:disabled {
  opacity: 0.2;
  cursor: not-allowed;
}

.gs-step-val {
  min-width: 20px;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

/* Slider rows */
.gs-slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gs-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--border);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.gs-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--green);
  border: 2px solid var(--elevated-surface);
  cursor: pointer;
}

.gs-slider-val {
  font-size: 10px;
  font-weight: 600;
  font-family: var(--mono, monospace);
  color: var(--text2);
  min-width: 28px;
  text-align: right;
}
</style>

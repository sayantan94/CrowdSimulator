/**
 * Shared simulation state composable.
 *
 * Keeps a single WebSocket connection alive across ResearchView → SimulateView
 * transitions. Both views call useSimulation() and get the same reactive state.
 * The backend runs the pipeline on one WS connection with a confirmation gate
 * between Phase 1 (research+profiles) and Phase 2 (simulate+analyze).
 */
import { reactive, computed } from 'vue'
import { connectWS } from '../api'
import { useAuth } from './useAuth'

// Tool icons — matches x-lens style
const TOOL_ICONS = {
  web_search: '◎',
  fetch: '↗',
  shell: '$',
  run_oasis_simulation: '▶',
  read_simulation_results: '📊',
}

// Module-level singleton state — shared across all components that import this
const state = reactive({
  scenarioId: null,
  phase: 'idle', // idle | researching | awaiting_confirmation | simulating | analyzing | strategizing | complete
  phaseLabel: '',
  agents: [],
  terminalEntries: [],
  timelineActions: [],
  logActions: [],
  interactions: [],
  contextPreview: '',
  currentRound: 0,
  totalRounds: 0,
  sentimentCounts: { positive: 0, neutral: 0, negative: 0 },
  simulationComplete: false,
  awaitingConfirmation: false,
  errorMsg: '',
  errors: [], // { message, type, timestamp }
  researchSources: [],
  researchSummary: '',
  sourcesCount: 0,
  searchCount: 0, // number of web searches performed
  searchResults: [], // { query, content, tool, duration, timestamp }
  // Config
  modelName: '',
  searchModelName: '',
  // A/B testing
  isAB: false,
  currentVariant: null, // { id, text }
  variants: [],         // [{ id, text }]
  variantResults: {},    // { A: { actions, sentiment, ... }, B: { ... } }
})

let ws = null
let actionCounter = 0
let textBuffer = ''
let textFlushTimer = null
const pendingToolQueries = new Map() // toolCallId -> { query, tool }

function reset() {
  state.scenarioId = null
  state.phase = 'idle'
  state.phaseLabel = ''
  state.agents = []
  state.terminalEntries = []
  state.timelineActions = []
  state.logActions = []
  state.interactions = []
  state.contextPreview = ''
  state.currentRound = 0
  state.totalRounds = 0
  state.sentimentCounts = { positive: 0, neutral: 0, negative: 0 }
  state.simulationComplete = false
  state.awaitingConfirmation = false
  state.errorMsg = ''
  state.errors = []
  state.researchSources = []
  state.researchSummary = ''
  state.sourcesCount = 0
  state.searchCount = 0
  state.searchResults = []
  state.modelName = ''
  state.searchModelName = ''
  state.isAB = false
  state.currentVariant = null
  state.variants = []
  state.variantResults = {}
  actionCounter = 0
  textBuffer = ''
  if (textFlushTimer) clearTimeout(textFlushTimer)
  textFlushTimer = null
}

function addEntry(type, message, prefix) {
  state.terminalEntries.push({ type, message, prefix })
}

// Flush buffered text deltas into terminal as a single entry
function flushTextBuffer() {
  if (textBuffer.trim()) {
    const lines = textBuffer.trim().split('\n')
    for (const line of lines) {
      if (line.trim()) {
        addEntry('thinking', line.trim().slice(0, 200), '~')
      }
    }
  }
  textBuffer = ''
  textFlushTimer = null
}

// --- Event handlers ---

function handleResearchEvent(data) {
  const eventType = data.event_type

  if (eventType === 'tool_start') {
    const icon = TOOL_ICONS[data.tool_name] || '⚙'
    const label = data.label || data.tool_name
    addEntry('tool-start', `${icon} ${label}`, '⟳')

    if (data.url) {
      addEntry('tool-detail', data.url, '  ')
    } else if (data.query && data.tool_name === 'web_search') {
      addEntry('tool-detail', `"${data.query}"`, '  ')
    } else if (data.command) {
      addEntry('tool-detail', data.command, '  ')
    }

    // Count searches and update phase label
    if (data.tool_name === 'web_search') {
      state.searchCount++
      if (state.phase === 'researching') {
        state.phaseLabel = `Researching... (search ${state.searchCount})`
      }
    }

    // Track query/url for later association with result
    if (data.tool_call_id && (data.tool_name === 'web_search' || data.tool_name === 'fetch')) {
      pendingToolQueries.set(data.tool_call_id, {
        query: data.query || data.url || data.label || '',
        tool: data.tool_name,
      })
    }
  } else if (eventType === 'tool_end') {
    const icon = data.is_error ? '✗' : '✓'
    const dur = data.duration ? ` (${data.duration}s)` : ''
    const name = data.tool_name || ''
    addEntry(
      data.is_error ? 'tool-error' : 'tool-done',
      `${icon} ${name}${dur}`,
      ' '
    )
    if (data.is_error) {
      const errMsg = data.result_preview || data.error || `${name} failed`
      state.errors.push({ message: errMsg, type: 'tool', tool: name, timestamp: Date.now() })
    }
    if (data.result_preview && !data.is_error) {
      addEntry('tool-result', data.result_preview.slice(0, 140), '  ')
    }
    // Store full search/fetch results for the research panel
    if (data.result_content && !data.is_error) {
      const pending = pendingToolQueries.get(data.tool_call_id)
      pendingToolQueries.delete(data.tool_call_id)
      state.searchResults.push({
        query: pending?.query || '',
        tool: data.tool_name,
        toolCallId: data.tool_call_id,
        content: data.result_content,
        duration: data.duration,
        timestamp: Date.now(),
      })
    }
  } else if (eventType === 'text_delta') {
    textBuffer += data.text
    if (!textFlushTimer) {
      textFlushTimer = setTimeout(flushTextBuffer, 400)
    }
  } else if (eventType === 'tool_execution_start') {
    addEntry('search', `searching: ${data.query || data.tool_name || 'web'}`, '>')
  } else if (eventType === 'tool_execution_end') {
    const preview = data.result_preview || data.result || 'results found'
    addEntry('found', typeof preview === 'string' ? preview : JSON.stringify(preview).slice(0, 120), '<')
  } else if (eventType === 'message_end') {
    const text = data.text || data.content || ''
    if (text) addEntry('seed', text.slice(0, 200), '>')
  } else if (eventType === 'content_block_delta') {
    // Legacy streaming text — skip
  } else {
    const text = data.message || data.text || data.content || ''
    if (text) addEntry('info', typeof text === 'string' ? text.slice(0, 160) : JSON.stringify(text).slice(0, 160))
  }
}

function handleGenerateEvent(data) {
  if (data.event_type === 'message_end') {
    const text = data.text || data.content || ''
    if (text) addEntry('gen', text.slice(0, 160), '>')
  }
}

function classifySentiment(action) {
  const agent = state.agents.find(a => a.agent_id === action.agent_id)
  const bias = agent?.sentiment_bias ?? 0
  const at = action.action_type
  if (at === 'DO_NOTHING') return 'neutral'
  if (['DISLIKE', 'DISLIKE_POST', 'DISLIKE_COMMENT', 'DOWNVOTE_POST'].includes(at)) return 'negative'
  if (bias > 0.2) return 'positive'
  if (bias < -0.2) return 'negative'
  return 'neutral'
}

function handleEvent(msg) {
  switch (msg.event) {
    case 'config': {
      if (msg.model) state.modelName = msg.model
      if (msg.search_model) state.searchModelName = msg.search_model
      addEntry('info', `model: ${msg.model || '?'} | search: ${msg.search_model || '?'}`)
      break
    }

    case 'phase': {
      const phaseLabels = {
        researching: 'Researching topic...',
        simulating: msg.message || 'Running simulation...',
        analyzing: 'Reading simulation results...',
        strategizing: 'Generating strategy & recommendations...',
        awaiting_confirmation: msg.message || 'Review personas',
      }
      state.phaseLabel = phaseLabels[msg.phase] || msg.message || msg.phase
      addEntry('phase', msg.message || `phase: ${msg.phase}`, '#')
      if (msg.phase === 'awaiting_confirmation') {
        state.phase = 'awaiting_confirmation'
        state.awaitingConfirmation = true
      } else if (msg.phase === 'simulating') {
        state.phase = 'simulating'
      } else if (msg.phase === 'analyzing') {
        state.phase = 'analyzing'
      } else if (msg.phase === 'strategizing') {
        state.phase = 'strategizing'
      }
      break
    }

    case 'research_event':
      handleResearchEvent(msg.data || msg)
      break

    case 'research_complete':
      state.phaseLabel = 'Generating Personas...'
      if (msg.context_preview) state.contextPreview = msg.context_preview
      addEntry('success', 'research complete -- building personas', '#')
      break

    case 'generate_event':
      handleGenerateEvent(msg.data || msg)
      break

    case 'agent_generated':
      if (!state.agents.find(a => a.agent_id === msg.agent_id)) {
        state.agents.push({
          agent_id: msg.agent_id,
          name: msg.name,
          username: msg.username,
          archetype: msg.archetype,
          sentiment_bias: msg.sentiment_bias,
          influence_weight: msg.influence_weight,
          activity_level: msg.activity_level,
          bio: msg.bio,
          persona: msg.persona || '',
          age: msg.age,
          gender: msg.gender || '',
          mbti: msg.mbti || '',
          profession: msg.profession || '',
          interested_topics: msg.interested_topics || [],
          research_basis: msg.research_basis || '',
        })
        addEntry('gen', `persona created: ${msg.name} (${msg.archetype})`, '+')
      }
      break

    case 'agents_ready':
      state.awaitingConfirmation = true
      state.phase = 'awaiting_confirmation'
      state.sourcesCount = msg.sources_count || 0
      state.researchSummary = msg.research_summary || ''
      state.researchSources = msg.sources || []
      addEntry('success', `${msg.count} personas ready — ${msg.sources_count || 0} sources analyzed`, '★')
      break

    case 'simulation_action': {
      const action = {
        _key: `act-${actionCounter++}`,
        round: msg.round,
        agent_id: msg.agent_id,
        agent_name: msg.agent_name,
        platform: msg.platform,
        action_type: msg.action_type,
        content: msg.content,
        stats: msg.stats,
        variant_id: state.currentVariant?.id || null,
      }
      if (msg.round > state.currentRound) state.currentRound = msg.round
      state.timelineActions.push(action)
      state.logActions.push(action)

      const cat = classifySentiment(action)
      state.sentimentCounts[cat]++

      if (action.agent_id && action.stats?.target_agent_id) {
        state.interactions.push({
          source: action.agent_id,
          target: action.stats.target_agent_id,
        })
      }
      break
    }

    case 'simulation_progress': {
      if (msg.round) state.currentRound = msg.round
      if (msg.total_rounds) state.totalRounds = msg.total_rounds
      if (msg.message) {
        const match = msg.message.match(/round\s+(\d+)\/(\d+)/i)
        if (match) {
          state.currentRound = parseInt(match[1])
          state.totalRounds = parseInt(match[2])
        }
        const plat = msg.platform ? msg.platform.charAt(0).toUpperCase() + msg.platform.slice(1) : ''
        const roundInfo = state.totalRounds ? ` — round ${state.currentRound}/${state.totalRounds}` : ''
        state.phaseLabel = plat ? `Simulating ${plat}${roundInfo}` : msg.message
      }
      break
    }

    case 'variant_start': {
      state.isAB = true
      state.currentVariant = { id: msg.variant_id, text: msg.text }
      if (!state.variants.find(v => v.id === msg.variant_id)) {
        state.variants.push({ id: msg.variant_id, text: msg.text })
      }
      // Reset per-variant tracking
      state.currentRound = 0
      state.totalRounds = 0
      addEntry('phase', `Starting variant ${msg.variant_id} (${msg.variant_index + 1}/${msg.total_variants})`, '#')
      break
    }

    case 'variant_complete': {
      const vid = msg.variant_id
      // Save snapshot of current actions for this variant
      state.variantResults[vid] = {
        ...msg.results,
        timelineActions: state.timelineActions.filter(a => true), // will be tagged below
      }
      addEntry('success', `Variant ${vid} complete`, '★')
      break
    }

    case 'simulation_complete':
      if (msg.is_ab) {
        state.isAB = true
        state.variantResults = msg.results
      }
      state.simulationComplete = true
      state.phase = 'complete'
      state.phaseLabel = 'Simulation complete'
      // Refresh usage info after simulation
      try { useAuth().refreshUserInfo() } catch {}
      break

    case 'simulation_error': {
      const errMsg = msg.message || `${msg.platform || 'Platform'} simulation failed`
      state.errors.push({ message: errMsg, type: 'platform', platform: msg.platform, timestamp: Date.now() })
      addEntry('error', errMsg, '!')
      break
    }

    case 'error':
      state.errorMsg = msg.message || 'An error occurred'
      state.phase = 'error'
      state.errors.push({ message: msg.message || 'An error occurred', type: 'fatal', timestamp: Date.now() })
      addEntry('error', msg.message || 'unknown error', '!')
      break
  }
}

// --- Public API ---

function connect(scenarioId) {
  if (ws && state.scenarioId === scenarioId && ws.readyState <= 1) return

  // If reconnecting to the same scenario (e.g. page refresh), don't reset state
  const isReconnect = state.scenarioId === scenarioId && state.phase !== 'idle'
  disconnect()
  if (!isReconnect) {
    reset()
    state.phase = 'researching'
    state.phaseLabel = 'Researching...'
  }
  state.scenarioId = scenarioId

  ws = connectWS(scenarioId)

  ws.onopen = () => addEntry('info', isReconnect ? 'reconnected to simulation' : 'connected to simulation pipeline')

  ws.onmessage = (e) => {
    let msg
    try { msg = JSON.parse(e.data) } catch { return }
    handleEvent(msg)
  }

  ws.onerror = () => {
    addEntry('error', 'websocket connection error', '!')
    state.errorMsg = 'WebSocket connection error'
  }

  ws.onclose = () => addEntry('info', 'connection closed')
}

function confirmSimulation() {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ action: 'confirm' }))
    state.awaitingConfirmation = false
    state.phase = 'simulating'
    state.phaseLabel = 'Starting simulation...'
    addEntry('phase', 'user confirmed — starting simulation', '#')
  }
}

function disconnect() {
  if (ws) {
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
    ws.close()
    ws = null
  }
}

const sentiment = computed(() => {
  const { positive, neutral, negative } = state.sentimentCounts
  const total = positive + neutral + negative
  if (total === 0) return { positive: 33, neutral: 34, negative: 33 }
  return {
    positive: Math.round((positive / total) * 100),
    neutral: Math.round((neutral / total) * 100),
    negative: Math.round((negative / total) * 100),
  }
})

const progressPct = computed(() => {
  if (!state.totalRounds) return 0
  return Math.min(100, Math.round((state.currentRound / state.totalRounds) * 100))
})

export function useSimulation() {
  return {
    state,
    sentiment,
    progressPct,
    connect,
    confirmSimulation,
    disconnect,
    reset,
  }
}

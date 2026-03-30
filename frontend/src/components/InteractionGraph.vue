<template>
  <div class="ig">
    <div class="ig-head">
      <div class="ig-head-left">
        <span class="ig-beacon"></span>
        <span class="ig-title font-mono">INTERACTION GRAPH</span>
      </div>
      <div class="ig-controls">
        <button class="ig-btn font-mono" @click="resetSelection" v-if="selectedNode">
          <span class="ig-btn-icon">&#x2715;</span> CLEAR
        </button>
        <span class="ig-meta font-mono">{{ agents.length }} nodes · {{ edgeCount }} links</span>
      </div>
    </div>
    <div class="ig-main">
      <div class="ig-viz" ref="containerRef">
        <svg ref="svgRef"></svg>
        <!-- Hover tooltip -->
        <div class="ig-tooltip" ref="tooltipRef" v-show="hoverNode" :style="tooltipStyle">
          <div class="ig-tt-name">{{ hoverNode?.name }}</div>
          <div class="ig-tt-arch font-mono" :style="{ color: hoverNode ? archColor(hoverNode.archetype) : '' }">{{ hoverNode?.archetype }}</div>
          <div class="ig-tt-stats font-mono">
            <span :class="sentCls(hoverNode?.sentiment)">{{ sentFmt(hoverNode?.sentiment) }}</span>
            <span class="ig-tt-sep">·</span>
            <span>{{ hoverNode?.actionCount }} actions</span>
          </div>
          <div class="ig-tt-last font-mono" v-if="hoverNode?.lastAction">{{ hoverNode.lastAction }}</div>
        </div>
      </div>
      <!-- Selected agent detail panel -->
      <Transition name="panel">
        <div class="ig-panel" v-if="selected">
          <div class="igp-head">
            <div class="igp-av" :style="{ background: archColor(selected.archetype), boxShadow: isDark ? `0 0 12px ${archColor(selected.archetype)}66` : 'none' }">{{ initials(selected.name) }}</div>
            <div class="igp-info">
              <div class="igp-name">{{ selected.name }}</div>
              <div class="igp-arch font-mono" :style="{ color: archColor(selected.archetype) }">{{ selected.archetype }}</div>
            </div>
            <button class="igp-close" @click="resetSelection">&times;</button>
          </div>
          <div class="igp-stats">
            <div class="igp-stat">
              <span class="igp-sl font-mono">SENTIMENT</span>
              <span class="igp-sv font-mono" :class="sentCls(selected.sentiment)">{{ sentFmt(selected.sentiment) }}</span>
            </div>
            <div class="igp-stat">
              <span class="igp-sl font-mono">INFLUENCE</span>
              <span class="igp-sv font-mono">{{ selected.influence?.toFixed(1) }}</span>
            </div>
            <div class="igp-stat">
              <span class="igp-sl font-mono">ACTIONS</span>
              <span class="igp-sv font-mono">{{ selected.actionCount }}</span>
            </div>
          </div>
          <div class="igp-bio" v-if="selected.bio">{{ selected.bio }}</div>
          <div class="igp-actions" v-if="selectedActions.length">
            <span class="igp-conn-lbl font-mono">RECENT ACTIONS</span>
            <div v-for="(act, i) in selectedActions" :key="i" class="igp-action">
              <span class="igp-action-type font-mono" :class="actionSentiment(act.action_type)">{{ formatActionType(act.action_type) }}</span>
              <span class="igp-action-round font-mono">R{{ act.round }}</span>
            </div>
          </div>
          <div class="igp-conn" v-if="selectedConnections.length">
            <span class="igp-conn-lbl font-mono">CONNECTED TO ({{ selectedConnections.length }})</span>
            <div v-for="c in selectedConnections" :key="c.id" class="igp-conn-item" @click="selectNodeById(c.id)">
              <span class="igp-conn-dot" :style="{ background: archColor(c.archetype), boxShadow: isDark ? `0 0 4px ${archColor(c.archetype)}` : 'none' }"></span>
              <span class="igp-conn-name">{{ c.name }}</span>
              <span class="igp-conn-w font-mono">{{ c.weight }}x</span>
            </div>
          </div>
        </div>
      </Transition>
    </div>
    <div class="ig-legend" v-if="uniqueArch.length">
      <div v-for="arch in uniqueArch" :key="arch.name" class="ig-lg">
        <span class="ig-lg-dot" :style="{ background: archColor(arch.name), boxShadow: isDark ? `0 0 5px ${archColor(arch.name)}88` : 'none' }"></span>
        <span class="ig-lg-name font-mono">{{ arch.name }} <span class="ig-lg-ct">{{ arch.count }}</span></span>
      </div>
      <div class="ig-lg ig-lg-sent">
        <span class="ig-lg-ring pos"></span><span class="ig-lg-name font-mono">pos</span>
        <span class="ig-lg-ring neg"></span><span class="ig-lg-name font-mono">neg</span>
        <span class="ig-lg-ring neut"></span><span class="ig-lg-name font-mono">neu</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as d3 from 'd3'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  actions: { type: Array, default: () => [] }
})

const containerRef = ref(null)
const svgRef = ref(null)
const tooltipRef = ref(null)
const selectedNode = ref(null)
const selected = ref(null)
const selectedConnections = ref([])
const selectedActions = ref([])
const hoverNode = ref(null)
const tooltipStyle = ref({ left: '0px', top: '0px' })
const isDark = ref(false)

let simulation = null
let resizeObserver = null
let themeObserver = null
let currentNodes = []
let currentLinks = []
let nodeElements = null
let linkElements = null

// Theme-adaptive palettes
const lightColors = {
  supporter: '#059669', skeptic: '#dc2626', neutral: '#3b82f6',
  journalist: '#7c3aed', troll: '#ea580c', influencer: '#d97706',
  expert: '#0891b2', casual_observer: '#6b7280'
}
const darkColors = {
  supporter: '#34d399', skeptic: '#f87171', neutral: '#60a5fa',
  journalist: '#a78bfa', troll: '#fb923c', influencer: '#fbbf24',
  expert: '#22d3ee', casual_observer: '#9ca3af'
}

const archColor = (arch) => {
  const palette = isDark.value ? darkColors : lightColors
  return palette[arch?.toLowerCase()] || (isDark.value ? '#9ca3af' : '#6b7280')
}

// Action type categorization
const positiveActions = new Set(['LIKE', 'LIKE_POST', 'LIKE_COMMENT', 'REPOST', 'SUPPORT', 'SHARE', 'FOLLOW'])
const negativeActions = new Set(['DISLIKE', 'DISLIKE_POST', 'DISLIKE_COMMENT', 'DOWNVOTE_POST', 'UNLIKE_POST', 'REPORT', 'BLOCK', 'TROLL', 'ATTACK'])

const actionSentiment = (type) => {
  if (positiveActions.has(type)) return 'pos'
  if (negativeActions.has(type)) return 'neg'
  return 'neut'
}

const formatActionType = (type) => type?.replace(/_/g, ' ').toLowerCase() || 'unknown'

const sentCls = (v) => v > 0.2 ? 'pos' : v < -0.2 ? 'neg' : 'neut'
const sentFmt = (v) => v == null ? '--' : v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)
const initials = (name) => name ? name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?'

function checkTheme() {
  isDark.value = document.documentElement.getAttribute('data-theme') === 'dark'
}

const cssVar = (name, fallback = '') =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

const sentRingColor = (v) =>
  v > 0.2 ? cssVar('--green', '#10b981') :
  v < -0.2 ? cssVar('--red', '#ef4444') :
  cssVar('--text3', '#94a3b8')

function themeVars() {
  return {
    canvasBg: cssVar('--bg', '#111'),
    gridLine: cssVar('--border', '#333'),
    edgeDefault: cssVar('--border2', '#555'),
    edgeHighlight: isDark.value ? 0.9 : 0.7,
    edgeDim: isDark.value ? 0.02 : 0.04,
    labelColor: cssVar('--text3', '#888'),
    archLabelOpacity: isDark.value ? 0.6 : 0.8,
    nodeStroke: cssVar('--white', '#fff'),
    nodeStrokeWidth: isDark.value ? 1 : 2,
    nodeStrokeOpacity: isDark.value ? 0.35 : 0.9,
    glowStd: isDark.value ? 4 : 1.5,
    glowStrongStd: isDark.value ? 7 : 3,
    edgeGlowStd: isDark.value ? 1.5 : 0.5,
    haloOpacity: isDark.value ? 0.06 : 0.03,
    innerHighlightOpacity: isDark.value ? 0.07 : 0.12,
    textShadow: isDark.value ? '0 1px 3px rgba(0,0,0,0.5)' : 'none',
  }
}

const uniqueArch = computed(() => {
  const counts = {}
  for (const a of props.agents) {
    const arch = a.archetype?.toLowerCase() || 'neutral'
    counts[arch] = (counts[arch] || 0) + 1
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})

const archPositions = computed(() => {
  const archs = uniqueArch.value
  const pos = {}
  const angleStep = (2 * Math.PI) / Math.max(archs.length, 1)
  archs.forEach((a, i) => {
    pos[a.name] = { angle: i * angleStep }
  })
  return pos
})

// Build edges with sentiment info
const edges = computed(() => {
  const links = new Map()
  const byRound = {}
  for (const a of props.actions) {
    const r = a.round || 0
    if (!byRound[r]) byRound[r] = []
    byRound[r].push(a)
  }
  for (const roundActions of Object.values(byRound)) {
    const interacting = roundActions.filter(a =>
      ['CREATE_COMMENT', 'COMMENT', 'LIKE_COMMENT', 'LIKE_POST', 'UNLIKE_POST',
       'REPOST', 'LIKE', 'DISLIKE', 'DISLIKE_POST', 'DISLIKE_COMMENT', 'DOWNVOTE_POST',
       'REPORT', 'SHARE', 'SUPPORT', 'TROLL', 'ATTACK', 'FOLLOW'].includes(a.action_type)
    )
    for (let i = 0; i < interacting.length; i++) {
      for (let j = i + 1; j < interacting.length; j++) {
        const a = interacting[i].agent_id
        const b = interacting[j].agent_id
        if (a !== undefined && b !== undefined && a !== b) {
          const key = [Math.min(a, b), Math.max(a, b)].join('-')
          const existing = links.get(key) || { weight: 0, posCount: 0, negCount: 0 }
          existing.weight++
          // Track sentiment of interactions
          if (positiveActions.has(interacting[i].action_type)) existing.posCount++
          if (positiveActions.has(interacting[j].action_type)) existing.posCount++
          if (negativeActions.has(interacting[i].action_type)) existing.negCount++
          if (negativeActions.has(interacting[j].action_type)) existing.negCount++
          links.set(key, existing)
        }
      }
    }
  }
  return [...links.entries()].map(([key, data]) => {
    const [s, t] = key.split('-').map(Number)
    return { source: s, target: t, weight: data.weight, posCount: data.posCount, negCount: data.negCount }
  })
})

const edgeCount = computed(() => edges.value.length)

const actionCounts = computed(() => {
  const counts = {}
  for (const a of props.actions) {
    if (a.agent_id !== undefined) counts[a.agent_id] = (counts[a.agent_id] || 0) + 1
  }
  return counts
})

// Last action per agent
const lastActions = computed(() => {
  const last = {}
  for (const a of props.actions) {
    if (a.agent_id !== undefined) {
      last[a.agent_id] = formatActionType(a.action_type)
    }
  }
  return last
})

// Most recent round that has actions
const maxRound = computed(() => {
  let max = 0
  for (const a of props.actions) {
    if ((a.round || 0) > max) max = a.round
  }
  return max
})

// Agents who acted in the latest round
const recentlyActive = computed(() => {
  const active = new Set()
  const latest = maxRound.value
  for (const a of props.actions) {
    if ((a.round || 0) === latest && a.agent_id !== undefined) {
      active.add(a.agent_id)
    }
  }
  return active
})

// Edge color based on interaction sentiment
function edgeColor(link) {
  const total = link.posCount + link.negCount
  if (total === 0) return cssVar('--border2', '#64748b')
  const posRatio = link.posCount / total
  if (posRatio > 0.6) return `${cssVar('--green', '#10b981')}66`
  if (posRatio < 0.4) return `${cssVar('--red', '#ef4444')}66`
  return `${cssVar('--blue', '#3b82f6')}66`
}

function selectNodeById(id) {
  const node = currentNodes.find(n => n.id === id)
  if (node) handleNodeClick(node)
}

function handleNodeClick(d) {
  selectedNode.value = d.id
  selected.value = { ...d }

  // Find actions for this agent
  selectedActions.value = props.actions
    .filter(a => a.agent_id === d.id)
    .slice(-8) // last 8 actions
    .reverse()

  const conns = []
  for (const link of currentLinks) {
    const sid = typeof link.source === 'object' ? link.source.id : link.source
    const tid = typeof link.target === 'object' ? link.target.id : link.target
    if (sid === d.id) {
      const target = currentNodes.find(n => n.id === tid)
      if (target) conns.push({ id: tid, name: target.name, archetype: target.archetype, weight: link.weight })
    } else if (tid === d.id) {
      const source = currentNodes.find(n => n.id === sid)
      if (source) conns.push({ id: sid, name: source.name, archetype: source.archetype, weight: link.weight })
    }
  }
  selectedConnections.value = conns.sort((a, b) => b.weight - a.weight)
  updateHighlight(d.id)
}

function resetSelection() {
  selectedNode.value = null
  selected.value = null
  selectedConnections.value = []
  selectedActions.value = []
  updateHighlight(null)
}

function updateHighlight(activeId) {
  if (!nodeElements || !linkElements) return
  const tv = themeVars()

  if (activeId === null) {
    nodeElements.attr('opacity', 1)
    linkElements
      .attr('opacity', d => 0.12 + (d.weight / Math.max(1, ...currentLinks.map(l => l.weight))) * 0.35)
      .attr('stroke', d => edgeColor(d))
      .attr('stroke-width', d => {
        const maxW = Math.max(1, ...currentLinks.map(l => l.weight))
        return Math.max(0.8, (d.weight / maxW) * 3)
      })
    return
  }

  const connectedIds = new Set([activeId])
  for (const link of currentLinks) {
    const sid = typeof link.source === 'object' ? link.source.id : link.source
    const tid = typeof link.target === 'object' ? link.target.id : link.target
    if (sid === activeId) connectedIds.add(tid)
    if (tid === activeId) connectedIds.add(sid)
  }

  nodeElements.attr('opacity', d => connectedIds.has(d.id) ? 1 : 0.08)
  linkElements
    .attr('opacity', d => {
      const sid = typeof d.source === 'object' ? d.source.id : d.source
      const tid = typeof d.target === 'object' ? d.target.id : d.target
      return (sid === activeId || tid === activeId) ? tv.edgeHighlight : tv.edgeDim
    })
    .attr('stroke', d => {
      const sid = typeof d.source === 'object' ? d.source.id : d.source
      const tid = typeof d.target === 'object' ? d.target.id : d.target
      if (sid === activeId || tid === activeId) {
        const activeNode = currentNodes.find(n => n.id === activeId)
        return archColor(activeNode?.archetype)
      }
      return tv.edgeDefault
    })
    .attr('stroke-width', d => {
      const sid = typeof d.source === 'object' ? d.source.id : d.source
      const tid = typeof d.target === 'object' ? d.target.id : d.target
      const maxW = Math.max(1, ...currentLinks.map(l => l.weight))
      const base = Math.max(0.8, (d.weight / maxW) * 3)
      return (sid === activeId || tid === activeId) ? base * 1.8 : base
    })
}

function renderGraph(preserveLayout = false) {
  if (!svgRef.value || !containerRef.value || props.agents.length === 0) return

  // Save existing node positions before rebuild
  const posMap = new Map()
  if (preserveLayout) {
    for (const n of currentNodes) {
      if (n.x != null) posMap.set(n.id, { x: n.x, y: n.y, vx: n.vx || 0, vy: n.vy || 0 })
    }
  }

  if (simulation) simulation.stop()

  const container = containerRef.value
  const width = container.clientWidth
  const height = container.clientHeight
  if (!width || !height) return

  const tv = themeVars()
  const svg = d3.select(svgRef.value).attr('width', width).attr('height', height)
  svg.selectAll('*').remove()

  const ac = actionCounts.value
  const la = lastActions.value
  const ra = recentlyActive.value
  const maxActions = Math.max(1, ...Object.values(ac))

  currentNodes = props.agents.map(a => ({
    id: a.agent_id,
    name: a.name,
    archetype: a.archetype?.toLowerCase() || 'neutral',
    influence: a.influence_weight || 0.5,
    sentiment: a.sentiment_bias || 0,
    bio: a.bio || '',
    actionCount: ac[a.agent_id] || 0,
    lastAction: la[a.agent_id] || null,
    isActive: ra.has(a.agent_id),
    radius: Math.max(18, 12 + Math.sqrt((ac[a.agent_id] || 0) / maxActions) * 18 + (a.influence_weight || 0.5) * 3.5)
  }))

  const nodeIds = new Set(currentNodes.map(n => n.id))
  currentLinks = edges.value.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target)).map(e => ({ ...e }))

  const maxWeight = Math.max(1, ...currentLinks.map(l => l.weight))
  const archPos = archPositions.value
  const clusterRadius = Math.min(width, height) * 0.38

  simulation = d3.forceSimulation(currentNodes)
    .force('link', d3.forceLink(currentLinks).id(d => d.id).distance(d => 120 - (d.weight / maxWeight) * 28).strength(d => 0.14 + (d.weight / maxWeight) * 0.32))
    .force('charge', d3.forceManyBody().strength(d => -340 - d.radius * 13))
    .force('collide', d3.forceCollide(d => d.radius + 14).strength(0.9))
    .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
    .force('archX', d3.forceX(d => {
      const ap = archPos[d.archetype]
      return ap ? width / 2 + Math.cos(ap.angle) * clusterRadius : width / 2
    }).strength(0.04))
    .force('archY', d3.forceY(d => {
      const ap = archPos[d.archetype]
      return ap ? height / 2 + Math.sin(ap.angle) * clusterRadius : height / 2
    }).strength(0.04))

  // Restore saved positions so nodes don't fly around on data updates
  if (preserveLayout && posMap.size > 0) {
    for (const node of currentNodes) {
      const p = posMap.get(node.id)
      if (p) { node.x = p.x; node.y = p.y; node.vx = p.vx; node.vy = p.vy; node.fx = undefined; node.fy = undefined }
    }
    simulation.alpha(0.12) // gentle settle, not full layout
  }

  // SVG Defs
  const defs = svg.append('defs')

  // Node glow
  const glowFilter = defs.append('filter').attr('id', 'node-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
  glowFilter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', tv.glowStd).attr('result', 'blur')
  glowFilter.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over')

  // Active node glow (stronger)
  const activeGlow = defs.append('filter').attr('id', 'active-glow').attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%')
  activeGlow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', tv.glowStrongStd).attr('result', 'blur')
  activeGlow.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over')

  // Edge glow
  const edgeGlowFilter = defs.append('filter').attr('id', 'edge-glow').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%')
  edgeGlowFilter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', tv.edgeGlowStd).attr('result', 'blur')
  edgeGlowFilter.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over')

  // Radial gradient per node
  currentNodes.forEach(node => {
    const color = archColor(node.archetype)
    const grad = defs.append('radialGradient').attr('id', `node-grad-${node.id}`).attr('cx', '35%').attr('cy', '35%').attr('r', '65%')
    grad.append('stop').attr('offset', '0%').attr('stop-color', d3.color(color).brighter(isDark.value ? 0.8 : 0.5))
    grad.append('stop').attr('offset', '60%').attr('stop-color', color)
    grad.append('stop').attr('offset', '100%').attr('stop-color', d3.color(color).darker(isDark.value ? 0.6 : 0.3))
  })

  // Grid pattern
  const gridPattern = defs.append('pattern').attr('id', 'grid').attr('width', 40).attr('height', 40).attr('patternUnits', 'userSpaceOnUse')
  gridPattern.append('rect').attr('width', 40).attr('height', 40).attr('fill', 'none')
  gridPattern.append('path').attr('d', 'M 40 0 L 0 0 0 40').attr('fill', 'none').attr('stroke', tv.gridLine).attr('stroke-width', 0.5)

  // Animated dash marker for strong edges
  const markerSize = 4
  defs.append('circle').attr('id', 'flow-dot').attr('r', markerSize / 2).attr('fill', isDark.value ? '#ffffff33' : '#00000022')

  const g = svg.append('g')

  // Background grid
  g.append('rect').attr('width', width * 3).attr('height', height * 3).attr('x', -width).attr('y', -height).attr('fill', 'url(#grid)').style('pointer-events', 'none')

  svg.call(d3.zoom().scaleExtent([0.3, 4]).on('zoom', (e) => g.attr('transform', e.transform)))

  // Edges — curved arcs with color coding
  linkElements = g.append('g').selectAll('path').data(currentLinks).enter().append('path')
    .attr('fill', 'none')
    .attr('stroke', d => edgeColor(d))
    .attr('stroke-width', d => Math.max(0.8, (d.weight / maxWeight) * 3))
    .attr('stroke-opacity', d => 0.12 + (d.weight / maxWeight) * 0.35)
    .attr('stroke-linecap', 'round')
    .attr('filter', d => d.weight / maxWeight > 0.5 ? 'url(#edge-glow)' : null)

  // Animated dash overlay for strong connections
  const strongEdges = currentLinks.filter(l => l.weight / maxWeight > 0.3)
  const dashOverlay = g.append('g').selectAll('path').data(strongEdges).enter().append('path')
    .attr('fill', 'none')
    .attr('stroke', d => edgeColor(d))
    .attr('stroke-width', 1)
    .attr('stroke-opacity', isDark.value ? 0.3 : 0.15)
    .attr('stroke-dasharray', '3 12')
    .attr('stroke-linecap', 'round')

  // Node groups
  nodeElements = g.append('g').selectAll('g').data(currentNodes).enter().append('g')
    .style('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
      .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null })
    )
    .on('click', (event, d) => {
      event.stopPropagation()
      handleNodeClick(d)
    })
    .on('mouseenter', (event, d) => {
      hoverNode.value = d
      const rect = containerRef.value.getBoundingClientRect()
      const svgRect = svgRef.value.getBoundingClientRect()
      // Get transform
      const gTransform = g.attr('transform')
      let tx = 0, ty = 0, ts = 1
      if (gTransform) {
        const m = gTransform.match(/translate\(([^,]+),([^)]+)\)/)
        if (m) { tx = parseFloat(m[1]); ty = parseFloat(m[2]) }
        const s = gTransform.match(/scale\(([^)]+)\)/)
        if (s) ts = parseFloat(s[1])
      }
      const x = d.x * ts + tx + svgRect.left - rect.left
      const y = d.y * ts + ty + svgRect.top - rect.top
      tooltipStyle.value = { left: (x + d.radius + 8) + 'px', top: (y - 10) + 'px' }
    })
    .on('mouseleave', () => { hoverNode.value = null })

  // Ambient glow halo
  nodeElements.append('circle')
    .attr('r', d => d.radius + (d.isActive ? 16 : 12))
    .attr('fill', d => archColor(d.archetype))
    .attr('opacity', d => d.isActive ? tv.haloOpacity * 2.5 : tv.haloOpacity)
    .attr('class', d => d.isActive ? 'halo-active' : '')
    .style('pointer-events', 'none')

  // Active pulse ring (only for recently active agents)
  nodeElements.filter(d => d.isActive).append('circle')
    .attr('r', d => d.radius + 6)
    .attr('fill', 'none')
    .attr('stroke', d => archColor(d.archetype))
    .attr('stroke-width', 1.5)
    .attr('opacity', 0.5)
    .attr('class', 'pulse-ring')
    .style('pointer-events', 'none')

  // Sentiment ring
  nodeElements.append('circle')
    .attr('r', d => d.radius + 3)
    .attr('fill', 'none')
    .attr('stroke', d => sentRingColor(d.sentiment))
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', d => {
      const circ = 2 * Math.PI * (d.radius + 3)
      const filled = circ * 0.7
      return `${filled} ${circ - filled}`
    })
    .attr('opacity', 0.5)

  // Main node with gradient
  nodeElements.append('circle')
    .attr('r', d => d.radius)
    .attr('fill', d => `url(#node-grad-${d.id})`)
    .attr('stroke', d => tv.nodeStroke || archColor(d.archetype))
    .attr('stroke-width', tv.nodeStrokeWidth)
    .attr('stroke-opacity', tv.nodeStrokeOpacity)
    .attr('filter', d => d.isActive ? 'url(#active-glow)' : 'url(#node-glow)')

  // Inner specular highlight
  nodeElements.append('circle')
    .attr('r', d => d.radius * 0.55)
    .attr('cx', d => -d.radius * 0.15)
    .attr('cy', d => -d.radius * 0.15)
    .attr('fill', 'white')
    .attr('opacity', tv.innerHighlightOpacity)
    .style('pointer-events', 'none')

  // Initials
  nodeElements.append('text')
    .text(d => initials(d.name))
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('font-size', d => Math.max(10, d.radius * 0.62) + 'px')
    .attr('fill', '#fff')
    .attr('font-weight', '700')
    .attr('font-family', 'var(--mono, monospace)')
    .attr('letter-spacing', '0.5px')
    .style('pointer-events', 'none')
    .style('text-shadow', tv.textShadow)

  // Name label
  nodeElements.append('text')
    .text(d => d.name?.length > 14 ? d.name.slice(0, 12) + '..' : d.name)
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.radius + 16)
    .attr('font-size', '11px')
    .attr('fill', tv.labelColor)
    .attr('font-family', 'var(--mono, monospace)')
    .attr('font-weight', '500')
    .style('pointer-events', 'none')

  // Archetype label
  nodeElements.append('text')
    .text(d => d.archetype)
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.radius + 28)
    .attr('font-size', '8.5px')
    .attr('fill', d => archColor(d.archetype))
    .attr('font-family', 'var(--mono, monospace)')
    .attr('font-weight', '600')
    .attr('text-transform', 'uppercase')
    .attr('letter-spacing', '0.5px')
    .attr('opacity', tv.archLabelOpacity)
    .style('pointer-events', 'none')

  // Action count badge for high-activity nodes
  nodeElements.filter(d => d.actionCount > 2).append('circle')
    .attr('cx', d => d.radius * 0.7)
    .attr('cy', d => -d.radius * 0.7)
    .attr('r', 7)
    .attr('fill', isDark.value ? '#1e293b' : '#fff')
    .attr('stroke', d => archColor(d.archetype))
    .attr('stroke-width', 1.5)
    .style('pointer-events', 'none')

  nodeElements.filter(d => d.actionCount > 2).append('text')
    .text(d => d.actionCount > 99 ? '99' : d.actionCount)
    .attr('x', d => d.radius * 0.7)
    .attr('y', d => -d.radius * 0.7)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('font-size', '8px')
    .attr('fill', d => archColor(d.archetype))
    .attr('font-weight', '700')
    .attr('font-family', 'var(--mono, monospace)')
    .style('pointer-events', 'none')

  svg.on('click', () => resetSelection())

  // Curved edge path
  function edgePath(d) {
    const sx = d.source.x, sy = d.source.y
    const tx = d.target.x, ty = d.target.y
    const dx = tx - sx, dy = ty - sy
    const dr = Math.sqrt(dx * dx + dy * dy) * (0.8 + (d.weight / maxWeight) * 0.5)
    return `M${sx},${sy}A${dr},${dr} 0 0,1 ${tx},${ty}`
  }

  // Animated dash offset for flowing edges
  let dashOffset = 0
  const animateDashes = () => {
    dashOffset -= 0.4
    dashOverlay.attr('stroke-dashoffset', dashOffset)
  }

  simulation.on('tick', () => {
    linkElements.attr('d', edgePath)
    dashOverlay.attr('d', edgePath)
    nodeElements.attr('transform', d => `translate(${d.x},${d.y})`)
    animateDashes()
  })
}

let renderTimer = null
let prevAgentCount = 0
watch(() => [props.agents.length, props.actions.length], ([agentLen]) => {
  if (renderTimer) clearTimeout(renderTimer)
  const agentsChanged = agentLen !== prevAgentCount
  prevAgentCount = agentLen
  // Full layout when agents change; preserve positions when only actions stream in
  const delay = agentsChanged ? 100 : 150
  renderTimer = setTimeout(() => nextTick(() => renderGraph(!agentsChanged)), delay)
})

onMounted(() => {
  checkTheme()

  themeObserver = new MutationObserver(() => {
    const wasDark = isDark.value
    checkTheme()
    if (wasDark !== isDark.value) nextTick(renderGraph)
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  resizeObserver = new ResizeObserver(() => nextTick(renderGraph))
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  nextTick(renderGraph)
})

onUnmounted(() => {
  if (simulation) simulation.stop()
  if (resizeObserver) resizeObserver.disconnect()
  if (themeObserver) themeObserver.disconnect()
  if (renderTimer) clearTimeout(renderTimer)
})
</script>

<style scoped>
.ig {
  background: var(--elevated-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ig-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--header-surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.ig-head-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ig-beacon {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 6px var(--green);
  animation: beacon-pulse 2s ease-in-out infinite;
}

@keyframes beacon-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.ig-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text3);
  letter-spacing: 0.8px;
}

.ig-controls { display: flex; align-items: center; gap: 6px; }
.ig-meta { font-size: 10px; color: var(--text3); letter-spacing: 0.3px; }

.ig-btn {
  font-size: 9px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text3);
  cursor: pointer;
  letter-spacing: 0.3px;
  display: flex;
  align-items: center;
  gap: 3px;
  transition: all 0.15s;
}

.ig-btn:hover { border-color: var(--border2); color: var(--text2); }
.ig-btn-icon { font-size: 8px; }

.ig-main {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}

.ig-viz {
  flex: 1;
  min-height: 120px;
  position: relative;
  background: var(--canvas-tint);
  overflow: hidden;
}

.ig-viz svg { width: 100%; height: 100%; display: block; }

/* Hover tooltip */
.ig-tooltip {
  position: absolute;
  pointer-events: none;
  background: var(--panel-glass-strong);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: var(--panel-shadow-soft);
  z-index: 10;
  min-width: 120px;
  max-width: 200px;
}

.ig-tt-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 2px;
}

.ig-tt-arch {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.ig-tt-stats {
  font-size: 10px;
  color: var(--text2);
}

.ig-tt-sep { margin: 0 3px; opacity: 0.4; }

.ig-tt-stats .pos { color: var(--green); }
.ig-tt-stats .neg { color: var(--red); }
.ig-tt-stats .neut { color: var(--text3); }

.ig-tt-last {
  font-size: 9px;
  color: var(--text3);
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px solid var(--border);
  text-transform: capitalize;
}

/* Detail panel */
.ig-panel {
  width: 260px;
  border-left: 1px solid var(--border);
  background: var(--elevated-surface);
  overflow-y: auto;
  flex-shrink: 0;
  padding: 12px;
}

.igp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.igp-av {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.igp-info { flex: 1; min-width: 0; }
.igp-name { font-size: 14px; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.igp-arch { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }

.igp-close {
  font-size: 18px;
  color: var(--text3);
  cursor: pointer;
  line-height: 1;
  flex-shrink: 0;
  background: none;
  border: none;
  transition: color 0.12s;
}

.igp-close:hover { color: var(--text); }

.igp-stats {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
}

.igp-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.igp-sl { font-size: 9px; color: var(--text3); font-weight: 600; letter-spacing: 0.4px; }
.igp-sv { font-size: 11px; font-weight: 700; }
.igp-sv.pos { color: var(--green); }
.igp-sv.neg { color: var(--red); }
.igp-sv.neut { color: var(--text3); }

.igp-bio {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text2);
  margin-bottom: 10px;
}

/* Recent actions list */
.igp-actions { margin-bottom: 8px; }

.igp-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
}

.igp-action:last-child { border-bottom: none; }

.igp-action-type {
  font-size: 10px;
  font-weight: 600;
  text-transform: capitalize;
}

.igp-action-type.pos { color: var(--green); }
.igp-action-type.neg { color: var(--red); }
.igp-action-type.neut { color: var(--text2); }

.igp-action-round {
  font-size: 9px;
  color: var(--text3);
  font-weight: 500;
}

.igp-conn { margin-top: 4px; }

.igp-conn-lbl {
  font-size: 9px;
  font-weight: 600;
  color: var(--text3);
  letter-spacing: 0.3px;
  display: block;
  margin-bottom: 6px;
}

.igp-conn-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s;
}

.igp-conn-item:hover { background: var(--surface); }
.igp-conn-item:last-child { border-bottom: none; }

.igp-conn-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.igp-conn-name { font-size: 11px; color: var(--text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.igp-conn-w { font-size: 9px; color: var(--text3); font-weight: 600; flex-shrink: 0; }

/* Legend */
.ig-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--header-surface-warm);
  flex-shrink: 0;
  align-items: center;
}

.ig-lg { display: flex; align-items: center; gap: 3px; }
.ig-lg-dot { width: 6px; height: 6px; border-radius: 50%; }
.ig-lg-name { font-size: 10px; color: var(--text3); text-transform: capitalize; }
.ig-lg-ct { color: var(--text3); opacity: 0.6; }

.ig-lg-sent {
  margin-left: auto;
  gap: 4px;
}

.ig-lg-ring {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid;
  background: transparent;
}

.ig-lg-ring.pos { border-color: var(--green); }
.ig-lg-ring.neg { border-color: var(--red); }
.ig-lg-ring.neut { border-color: var(--text3); }

/* Transitions */
.panel-enter-active { transition: all 0.2s ease-out; }
.panel-enter-from { opacity: 0; transform: translateX(10px); }
.panel-leave-active { transition: all 0.15s ease-in; }
.panel-leave-to { opacity: 0; transform: translateX(10px); }

/* SVG animations via :deep since D3 appends outside scoped context */
:deep(.pulse-ring) {
  animation: pulse-expand 1.5s ease-out infinite;
}

@keyframes pulse-expand {
  0% { r: inherit; opacity: 0.5; }
  100% { r: 30; opacity: 0; }
}

:deep(.halo-active) {
  animation: halo-breathe 1.5s ease-in-out infinite;
}

@keyframes halo-breathe {
  0%, 100% { opacity: 0.08; }
  50% { opacity: 0.2; }
}
</style>

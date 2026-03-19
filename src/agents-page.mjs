const POLL_INTERVAL_MS = 30 * 1000;
const UI_STATE_KEY = 'openclawAgentsPageState';
const DASHBOARD_STATE_KEY = 'projectDashboardState';
const BLOCKER_ACTION_ACTOR = 'dashboard-operator';

const dom = {
  themeToggle: document.getElementById('themeToggle'),
  refreshBtn: document.getElementById('refreshBtn'),
  lastUpdated: document.getElementById('lastUpdated'),
  refreshState: document.getElementById('refreshState'),
  heroFocus: document.getElementById('heroFocus'),
  heroPulseGrid: document.getElementById('heroPulseGrid'),
  heroPulseList: document.getElementById('heroPulseList'),
  notice: document.getElementById('notice'),
  metricsGrid: document.getElementById('metricsGrid'),
  workspaceSummary: document.getElementById('workspaceSummary'),
  workspaceResults: document.getElementById('workspaceResults'),
  agentSearchInput: document.getElementById('agentSearchInput'),
  presenceFilters: document.getElementById('presenceFilters'),
  agentZones: document.getElementById('agentZones'),
  agentDetail: document.getElementById('agentDetail')
};

const state = {
  overview: null,
  blockers: [],
  blockerSummary: null,
  selectedAgentId: null,
  theme: loadInitialTheme(),
  search: '',
  presenceFilter: 'all',
  isLoading: false,
  refreshTimer: null
};

function loadJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[AgentsPage] Failed to read localStorage key:', key, error);
    return null;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[AgentsPage] Failed to write localStorage key:', key, error);
  }
}

function loadInitialTheme() {
  const dashboardState = loadJsonStorage(DASHBOARD_STATE_KEY);
  if (dashboardState?.theme === 'dark' || dashboardState?.theme === 'light') {
    return dashboardState.theme;
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function loadUiState() {
  return loadJsonStorage(UI_STATE_KEY) || {};
}

function saveUiState() {
  writeJsonStorage(UI_STATE_KEY, {
    selectedAgentId: state.selectedAgentId,
    search: state.search,
    presenceFilter: state.presenceFilter
  });
}

function persistTheme(theme) {
  const dashboardState = loadJsonStorage(DASHBOARD_STATE_KEY) || {};
  dashboardState.theme = theme;
  writeJsonStorage(DASHBOARD_STATE_KEY, dashboardState);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  const icon = dom.themeToggle?.querySelector('.theme-toggle-icon');
  const label = dom.themeToggle?.querySelector('.theme-toggle-label');
  if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  if (label) label.textContent = isDark ? 'Light' : 'Dark';
  dom.themeToggle?.setAttribute('aria-pressed', isDark ? 'true' : 'false');
}

function showNotice(message) {
  if (!message) {
    dom.notice.style.display = 'none';
    dom.notice.textContent = '';
    return;
  }
  dom.notice.textContent = message;
  dom.notice.style.display = 'block';
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getAgentDepartment(agent) {
  const department = agent?.department;
  if (department && (department.slug || department.name || department.id)) {
    return {
      id: department.id || department.slug || slugify(department.name),
      slug: department.slug || slugify(department.name || department.id),
      name: department.name || 'Unassigned',
      description: department.description || 'Explicit org metadata has not been filled in yet.',
      color: department.color || '#64748b',
      icon: department.icon || 'folder',
      sortOrder: Number(department.sortOrder ?? department.sort_order) || 999,
      source: department.source || 'api'
    };
  }

  if (agent?.departmentSlug || agent?.departmentName) {
    return {
      id: agent.departmentId || agent.departmentSlug || slugify(agent.departmentName),
      slug: agent.departmentSlug || slugify(agent.departmentName),
      name: agent.departmentName || 'Unassigned',
      description: '',
      color: agent.departmentColor || '#64748b',
      icon: 'folder',
      sortOrder: 999,
      source: 'api'
    };
  }

  return null;
}

function getPresenceWeight(presence) {
  switch (presence) {
    case 'working':
      return 0;
    case 'queued':
      return 1;
    case 'idle':
      return 2;
    default:
      return 3;
  }
}

function groupAgents(agents = []) {
  const grouped = new Map();

  agents.forEach((agent) => {
    const department = getAgentDepartment(agent) || {
      id: 'unassigned',
      slug: 'unassigned',
      name: 'Unassigned',
      description: 'Configured agents without explicit org metadata yet.',
      color: '#64748b',
      icon: 'folder',
      sortOrder: 999,
      source: 'derived'
    };

    if (!grouped.has(department.slug)) {
      grouped.set(department.slug, {
        key: department.slug,
        title: department.name,
        description: department.description,
        sortOrder: department.sortOrder,
        color: department.color,
        icon: department.icon,
        agents: []
      });
    }

    grouped.get(department.slug).agents.push(agent);
  });

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      agents: group.agents.slice().sort((left, right) => {
        const presenceDelta = getPresenceWeight(left.presence) - getPresenceWeight(right.presence);
        if (presenceDelta !== 0) return presenceDelta;
        const workDelta = (right.queueSummary?.ready || 0) - (left.queueSummary?.ready || 0);
        if (workDelta !== 0) return workDelta;
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      })
    }))
    .sort((left, right) => {
      const sortDelta = (left.sortOrder || 0) - (right.sortOrder || 0);
      if (sortDelta !== 0) return sortDelta;
      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    });
}

function formatModel(modelId) {
  if (!modelId) return 'No model set';
  const parts = String(modelId).split('/');
  if (parts.length >= 2) {
    return parts.slice(1).join('/');
  }
  return modelId;
}

function formatModelCompact(modelId) {
  if (!modelId) return 'No model set';
  const formatted = formatModel(modelId)
    .replace(/:free$/i, '')
    .replace(/:assistant$/i, '');
  const parts = formatted.split('/');
  if (parts.length >= 2) {
    return `${parts[0]} · ${parts[parts.length - 1]}`;
  }
  return formatted;
}

function formatWorkspacePath(workspace) {
  if (!workspace) return 'Workspace not declared';
  const segments = workspace.split('/').filter(Boolean);
  if (segments.length <= 3) return workspace;
  return `.../${segments.slice(-3).join('/')}`;
}

function formatTimestamp(value) {
  if (!value) return 'No heartbeat yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No heartbeat yet';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelative(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  const deltaMs = Date.now() - date.getTime();
  const minutes = Math.round(deltaMs / 60000);
  if (minutes <= 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

function formatPresenceLabel(presence) {
  switch (presence) {
    case 'working':
      return 'Working';
    case 'queued':
      return 'Queued';
    case 'idle':
      return 'Idle';
    default:
      return 'Offline';
  }
}

function formatStatusLabel(status) {
  if (!status) return 'unknown';
  return String(status).replace(/_/g, ' ');
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function presenceLightColor(presence) {
  switch (presence) {
    case 'working':
      return 'var(--success)';
    case 'queued':
      return 'var(--warning)';
    case 'idle':
      return 'var(--accent)';
    default:
      return 'var(--offline)';
  }
}

function renderAvatar(seedValue, presence) {
  const seed = hashString(seedValue || 'openclaw');
  const hue = seed % 360;
  const activeIndices = [];

  for (let index = 0; index < 25; index += 1) {
    const bit = (seed >> (index % 16)) & 1;
    const mirrorIndex = index % 5 <= 2 ? index : index - ((index % 5) - (4 - (index % 5)));
    const mirroredBit = (seed >> (mirrorIndex % 16)) & 1;
    if (index === 0 || index === 4 || index === 20 || index === 24) continue;
    if (bit || mirroredBit || index === 6 || index === 8 || index === 16 || index === 18) {
      activeIndices.push(index);
    }
  }

  const cells = Array.from({ length: 25 }, (_, index) => (
    `<span class="${activeIndices.includes(index) ? 'is-on' : ''}"></span>`
  )).join('');

  return `
    <div class="agent-avatar-frame" style="--avatar-color: hsl(${hue} 82% 62%); --light-color: ${presenceLightColor(presence)};">
      <div class="agent-avatar-grid">${cells}</div>
      <div class="agent-lights">
        <span class="is-on"></span>
        <span class="${presence === 'working' || presence === 'queued' ? 'is-on' : ''}"></span>
        <span class="${presence === 'working' ? 'is-on' : ''}"></span>
      </div>
    </div>
  `;
}

function chooseSelectedAgent(agents = []) {
  if (!agents.length) {
    state.selectedAgentId = null;
    return;
  }

  const existing = agents.find((agent) => agent.id === state.selectedAgentId);
  if (existing) return;

  const preferred = agents.find((agent) => agent.default)
    || agents.find((agent) => agent.presence === 'working')
    || agents.find((agent) => agent.presence === 'queued')
    || agents[0];

  state.selectedAgentId = preferred?.id || null;
}

function getSelectedAgent() {
  return state.overview?.agents?.find((agent) => agent.id === state.selectedAgentId) || null;
}

function emptyBlockerSummary() {
  return {
    total: 0,
    workflowRuns: 0,
    tasks: 0,
    escalated: 0,
    byType: [],
    byDepartment: []
  };
}

function getBlockerSummary() {
  return state.blockerSummary || emptyBlockerSummary();
}

function getDepartmentBlockerSummary(departmentLike) {
  if (!departmentLike) return null;

  const summary = getBlockerSummary();
  return summary.byDepartment.find((entry) => (
    entry.departmentId === departmentLike.id
      || entry.departmentId === departmentLike.departmentId
      || entry.departmentSlug === departmentLike.slug
      || entry.departmentSlug === departmentLike.key
      || entry.departmentName === departmentLike.name
      || entry.departmentName === departmentLike.title
  )) || null;
}

function getBlockerSeverityWeight(severity) {
  switch (severity) {
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 2;
    default:
      return 3;
  }
}

function getSeverityChipClass(severity) {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'queued';
    case 'medium':
      return 'idle';
    default:
      return 'offline';
  }
}

function formatNextAction(action) {
  if (!action) return 'inspect blocker';
  return String(action).replace(/_/g, ' ');
}

function formatTopBlockerTypes(entries = [], limit = 3) {
  if (!Array.isArray(entries) || !entries.length) return 'No blockers';
  return entries
    .slice(0, limit)
    .map((entry) => `${entry.count} ${entry.label}`)
    .join(' • ');
}

function getAgentBlockers(agent) {
  if (!agent?.id) return [];

  return (state.blockers || [])
    .filter((item) => item.ownerAgentId === agent.id)
    .sort((left, right) => {
      const severityDelta = getBlockerSeverityWeight(left.severity) - getBlockerSeverityWeight(right.severity);
      if (severityDelta !== 0) return severityDelta;
      return new Date(right.detectedAt || 0) - new Date(left.detectedAt || 0);
    });
}

function getActionableRunId(blocker) {
  return blocker?.workflowRunId || (blocker?.entityType === 'workflow_run' ? blocker.entityId : null);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

function renderMetrics(summary = {}) {
  const metrics = [
    { label: 'Agents online', value: summary.online || 0, tone: 'accent' },
    { label: 'Working now', value: summary.working || 0, tone: 'success' },
    { label: 'Queued up', value: summary.readyTasks || 0, tone: 'warning' },
    { label: 'Blocked tasks', value: summary.blockedTasks || 0, tone: 'danger' },
    { label: 'Overdue tasks', value: summary.overdueTasks || 0, tone: 'muted' }
  ];

  dom.metricsGrid.innerHTML = metrics.map((metric) => `
    <div class="metric-card" data-tone="${escapeHtml(metric.tone)}">
      <strong>${escapeHtml(metric.value)}</strong>
      <span>${escapeHtml(metric.label)}</span>
    </div>
  `).join('');
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesSearch(agent, query) {
  if (!query) return true;
  const haystack = [
    agent.name,
    agent.displayName,
    agent.id,
    agent.workspace,
    agent.defaultModel,
    agent.departmentName,
    agent.department?.name,
    agent.role,
    ...(Array.isArray(agent.capabilities) ? agent.capabilities : []),
    agent.currentActivity,
    agent.currentTask?.title,
    ...(Array.isArray(agent.queue) ? agent.queue.map((task) => task?.title) : [])
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function filterAgents(agents = []) {
  const query = normalizeSearchText(state.search);
  return agents.filter((agent) => {
    const matchesPresence = state.presenceFilter === 'all' || agent.presence === state.presenceFilter;
    return matchesPresence && matchesSearch(agent, query);
  });
}

function renderHeroPulse(overview = {}, filteredAgents = []) {
  const agents = Array.isArray(overview.agents) ? overview.agents : [];
  const summary = overview.summary || {};
  const blockerSummary = getBlockerSummary();
  const staleCount = agents.filter((agent) => agent.stale).length;
  const filteredLabel = filteredAgents.length === agents.length
    ? 'All agents visible'
    : `Showing ${pluralize(filteredAgents.length, 'agent')} after filters`;

  const pulseCards = [
    {
      label: 'Coverage',
      value: `${summary.online || 0}/${summary.totalAgents || 0}`,
      note: 'agents with fresh heartbeats',
      tone: 'accent'
    },
    {
      label: 'Active load',
      value: `${summary.working || 0}`,
      note: `${summary.readyTasks || 0} ready tasks waiting`,
      tone: 'success'
    },
    {
      label: 'Attention',
      value: `${summary.blockedTasks || 0}`,
      note: `${summary.overdueTasks || 0} overdue tasks`,
      tone: 'warning'
    },
    {
      label: 'Signal health',
      value: `${staleCount}`,
      note: `${filteredLabel}`,
      tone: 'danger'
    }
  ];

  dom.heroPulseGrid.innerHTML = pulseCards.map((card) => `
    <article class="hero-pulse-card" data-tone="${escapeHtml(card.tone)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <p>${escapeHtml(card.note)}</p>
    </article>
  `).join('');

  const highlightedAgents = agents
    .slice()
    .sort((left, right) => {
      const presenceDelta = getPresenceWeight(left.presence) - getPresenceWeight(right.presence);
      if (presenceDelta !== 0) return presenceDelta;
      const loadLeft = (left.queueSummary?.ready || 0) + (left.queueSummary?.inProgress || 0) + (left.queueSummary?.blocked || 0);
      const loadRight = (right.queueSummary?.ready || 0) + (right.queueSummary?.inProgress || 0) + (right.queueSummary?.blocked || 0);
      if (loadRight !== loadLeft) return loadRight - loadLeft;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    })
    .filter((agent, index) => {
      if (index < 4) return true;
      return agent.default;
    })
    .slice(0, 4);

  const pulseItems = [];

  if (blockerSummary.total > 0) {
    const topDepartment = blockerSummary.byDepartment[0] || null;
    const blockerNote = topDepartment
      ? `${formatTopBlockerTypes(blockerSummary.byType)} • ${topDepartment.departmentName} carries ${topDepartment.total} blockers`
      : formatTopBlockerTypes(blockerSummary.byType);

    pulseItems.push(`
      <article class="hero-pulse-item">
        <div>
          <strong>Blocker radar</strong>
          <p>${escapeHtml(blockerNote)}</p>
        </div>
        <div class="detail-meta">
          <span class="presence-chip is-${escapeHtml(getSeverityChipClass(blockerSummary.byType[0]?.severity || 'medium'))}">${escapeHtml(pluralize(blockerSummary.total, 'blocker'))}</span>
          ${blockerSummary.escalated ? `<span class="meta-pill">${escapeHtml(`${blockerSummary.escalated} escalated`)}</span>` : ''}
        </div>
      </article>
    `);
  }

  if (!highlightedAgents.length && !pulseItems.length) {
    dom.heroPulseList.innerHTML = `
      <div class="empty-state">
        <strong>No agent telemetry yet.</strong>
        <p class="empty-copy">When OpenClaw agents send dashboard bridge heartbeats, their live state will appear here.</p>
      </div>
    `;
    return;
  }

  pulseItems.push(...highlightedAgents.map((agent) => {
    const loadText = `${agent.queueSummary.inProgress || 0} active • ${agent.queueSummary.ready || 0} ready • ${agent.queueSummary.blocked || 0} blocked`;
    const subText = agent.currentActivity || agent.currentTask?.title || `${formatRelative(agent.lastSeenAt)} heartbeat`;
    return `
      <article class="hero-pulse-item">
        <div>
          <strong>${escapeHtml(agent.name)}</strong>
          <p>${escapeHtml(subText)}</p>
        </div>
        <div class="detail-meta">
          <span class="presence-chip is-${escapeHtml(agent.presence)}">${escapeHtml(formatPresenceLabel(agent.presence))}</span>
          <span class="meta-pill">${escapeHtml(loadText)}</span>
        </div>
      </article>
    `;
  }));

  dom.heroPulseList.innerHTML = pulseItems.join('');
}

function renderHeroFocus(agent, filteredAgents = [], allAgents = []) {
  if (!dom.heroFocus) return;

  if (!agent) {
    dom.heroFocus.innerHTML = `
      <div class="hero-focus-head">
        <div>
          <h2>Current focus</h2>
          <p>No agent is selected yet.</p>
        </div>
        <span class="meta-pill">${escapeHtml(pluralize(filteredAgents.length, 'visible agent'))}</span>
      </div>
      <div class="empty-state">
        <strong>Choose an agent from the workspace.</strong>
        <p class="empty-copy">The selected agent's runtime, queue pressure, and routing model will appear here.</p>
      </div>
    `;
    return;
  }

  const visibleCount = filteredAgents.length;
  const allCount = allAgents.length;
  const activity = agent.currentActivity || agent.currentTask?.title || 'Waiting for a runnable dashboard task.';
  const department = getAgentDepartment(agent);

  dom.heroFocus.innerHTML = `
    <div class="hero-focus-head">
      <div>
        <h2>Current focus</h2>
        <p>Selected runtime from the filtered workspace view.</p>
      </div>
      <span class="meta-pill">${escapeHtml(`${visibleCount}/${allCount} visible`)}</span>
    </div>
    <div class="hero-focus-shell">
      ${renderAvatar(agent.id, agent.presence)}
      <div class="hero-focus-copy">
        <div>
          <h3>${escapeHtml(agent.name)}</h3>
          <p>${escapeHtml(activity)}</p>
        </div>
        <div class="detail-meta">
          <span class="presence-chip is-${escapeHtml(agent.presence)}">${escapeHtml(formatPresenceLabel(agent.presence))}</span>
          ${agent.default ? '<span class="meta-pill">Default agent</span>' : ''}
          ${department ? `<span class="meta-pill">${escapeHtml(department.name)}</span>` : ''}
          ${agent.role ? `<span class="meta-pill">${escapeHtml(agent.role)}</span>` : ''}
          <span class="meta-pill">${escapeHtml(formatModel(agent.defaultModel))}</span>
        </div>
        <div class="hero-focus-stats">
          <div class="hero-focus-stat">
            <strong>${escapeHtml(agent.queueSummary.ready || 0)}</strong>
            <span>Ready</span>
          </div>
          <div class="hero-focus-stat">
            <strong>${escapeHtml(agent.queueSummary.inProgress || 0)}</strong>
            <span>Active</span>
          </div>
          <div class="hero-focus-stat">
            <strong>${escapeHtml(agent.queueSummary.blocked || 0)}</strong>
            <span>Blocked</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderWorkspaceResults(filteredAgents = [], allAgents = []) {
  const base = state.presenceFilter === 'all'
    ? 'all presence states'
    : `${formatPresenceLabel(state.presenceFilter).toLowerCase()} agents`;
  const searchFragment = normalizeSearchText(state.search)
    ? ` matching "${state.search.trim()}"`
    : '';
  dom.workspaceResults.textContent = `Showing ${filteredAgents.length} of ${allAgents.length} ${base}${searchFragment}`;
}

function updatePresenceFilterUi() {
  const filterButtons = dom.presenceFilters?.querySelectorAll('[data-presence]') || [];
  filterButtons.forEach((button) => {
    const isActive = button.dataset.presence === state.presenceFilter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function renderZones(agents = []) {
  const groups = groupAgents(agents);

  if (!groups.length) {
    dom.agentZones.innerHTML = `
      <div class="empty-state">
        <strong>No agents match the current filters.</strong>
        <p class="empty-copy">Try a broader search or switch the presence filter back to all agents.</p>
      </div>
    `;
    return;
  }

  dom.agentZones.innerHTML = groups.map((group) => {
    const blockerSummary = getDepartmentBlockerSummary(group);
    return `
    <section class="zone-block">
      <div class="zone-header">
        <div>
          <h3>${escapeHtml(group.title)}</h3>
          <p>${escapeHtml(group.description)}</p>
          <div class="detail-meta">
            ${blockerSummary
              ? `
                <span class="meta-pill">${escapeHtml(pluralize(blockerSummary.total, 'blocker'))}</span>
                ${blockerSummary.byType.slice(0, 2).map((entry) => `<span class="meta-pill">${escapeHtml(`${entry.count} ${entry.label}`)}</span>`).join('')}
              `
              : '<span class="meta-pill">No blockers</span>'}
          </div>
        </div>
        <div class="zone-tally">${group.agents.length} agents</div>
      </div>
      <div class="zone-grid">
        ${group.agents.map((agent) => {
          const isSelected = agent.id === state.selectedAgentId;
          const activity = agent.currentActivity || agent.currentTask?.title || 'Waiting for a new task.';
          const compactModel = formatModelCompact(agent.defaultModel);
          const department = getAgentDepartment(agent);
          const subtitleParts = [];
          if (department) subtitleParts.push(department.name);
          if (agent.workspace) subtitleParts.push(formatWorkspacePath(agent.workspace));
          const subtitle = subtitleParts.length ? subtitleParts.join(' • ') : 'Workspace not declared';
          return `
            <button
              class="agent-card is-${escapeHtml(agent.presence)} ${isSelected ? 'is-selected' : ''}"
              type="button"
              data-agent-id="${escapeHtml(agent.id)}"
              aria-pressed="${isSelected ? 'true' : 'false'}"
            >
              <div class="agent-card-top">
                <div class="agent-card-heading">
                  <h3 class="agent-name">${escapeHtml(agent.name)}</h3>
                  <div class="agent-subtitle" title="${escapeHtml(subtitle)}">${escapeHtml(subtitle)}</div>
                </div>
                <span class="presence-chip is-${escapeHtml(agent.presence)}">${escapeHtml(formatPresenceLabel(agent.presence))}</span>
              </div>
              <div class="agent-stage">
                ${renderAvatar(agent.id, agent.presence)}
                <div class="agent-card-copy">
                  <div class="agent-activity ${agent.currentActivity || agent.currentTask ? '' : 'is-muted'}">${escapeHtml(activity)}</div>
                  <div class="agent-card-meta">
                    <div class="agent-badges">
                      ${agent.default ? '<span class="meta-pill">Default agent</span>' : ''}
                      ${agent.role ? `<span class="meta-pill">${escapeHtml(agent.role)}</span>` : ''}
                    </div>
                    <div class="agent-model" title="${escapeHtml(formatModel(agent.defaultModel))}">${escapeHtml(compactModel)}</div>
                  </div>
                </div>
              </div>
              <div class="agent-stats">
                <div class="agent-stat">
                  <strong>${agent.queueSummary.inProgress || 0}</strong>
                  <span>Active</span>
                </div>
                <div class="agent-stat">
                  <strong>${agent.queueSummary.ready || 0}</strong>
                  <span>Ready</span>
                </div>
                <div class="agent-stat">
                  <strong>${agent.queueSummary.blocked || 0}</strong>
                  <span>Blocked</span>
                </div>
                <div class="agent-stat">
                  <strong>${agent.queueSummary.overdue || 0}</strong>
                  <span>Overdue</span>
                </div>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;
  }).join('');

  dom.agentZones.querySelectorAll('[data-agent-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedAgentId = button.dataset.agentId;
      saveUiState();
      render();
    });
  });
}

function renderQueueItems(queue = []) {
  if (!queue.length) {
    return `
      <div class="empty-state">
        <strong>No queued work.</strong>
        <p class="empty-copy">This agent does not have ready or active dashboard tasks right now.</p>
      </div>
    `;
  }

  return `
    <div class="queue-list">
      ${queue.map((task) => `
        <article class="queue-item">
          <div class="queue-item-top">
            <div class="queue-item-title">${escapeHtml(task.title)}</div>
            <span class="presence-chip is-${task.status === 'in_progress' ? 'working' : task.status === 'blocked' ? 'queued' : 'idle'}">${escapeHtml(formatStatusLabel(task.status))}</span>
          </div>
          <p class="queue-item-subtitle">${escapeHtml(task.project_name || 'No project')} ${task.due_date ? `| due ${escapeHtml(formatTimestamp(task.due_date))}` : ''}</p>
          <div class="queue-item-meta">
            <span class="meta-pill">${escapeHtml(task.priority || 'medium')}</span>
            ${task.preferred_model ? `<span class="meta-pill">${escapeHtml(formatModel(task.preferred_model))}</span>` : ''}
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderBlockerConsole(agent) {
  const blockers = getAgentBlockers(agent);

  if (!blockers.length) {
    return `
      <div class="empty-state">
        <strong>No active blockers.</strong>
        <p class="empty-copy">This agent currently has no classified blocked runs or tasks requiring operator intervention.</p>
      </div>
    `;
  }

  return `
    <div class="queue-list">
      ${blockers.map((blocker) => {
        const actionableRunId = getActionableRunId(blocker);
        const escalationText = blocker.escalatedTo
          ? `Escalated to ${blocker.escalatedTo}`
          : blocker.escalationStatus === 'escalated'
            ? 'Escalated'
            : 'Not escalated';
        const pauseText = blocker.pausedAt
          ? `Paused by ${blocker.pausedBy || 'operator'}`
          : 'Not paused';

        return `
          <article class="queue-item">
            <div class="queue-item-top">
              <div class="queue-item-title">${escapeHtml(blocker.title || blocker.entityId || 'Blocked work')}</div>
              <span class="presence-chip is-${escapeHtml(getSeverityChipClass(blocker.severity))}">${escapeHtml(blocker.blockerLabel || formatStatusLabel(blocker.blockerType))}</span>
            </div>
            <p class="queue-item-subtitle">${escapeHtml(blocker.blockerDescription || 'Blocked work requires operator attention.')}</p>
            <div class="queue-item-meta">
              <span class="meta-pill">${escapeHtml(blocker.entityType === 'workflow_run' ? 'Workflow run' : 'Task blocker')}</span>
              <span class="meta-pill">${escapeHtml(formatStatusLabel(blocker.status))}</span>
              <span class="meta-pill">${escapeHtml(`Next: ${formatNextAction(blocker.nextAction)}`)}</span>
              <span class="meta-pill">${escapeHtml(`${escalationText} • ${pauseText}`)}</span>
              <span class="meta-pill">${escapeHtml(`Detected ${formatRelative(blocker.detectedAt)}`)}</span>
            </div>
            ${actionableRunId ? `
              <div class="blocker-actions" data-blocker-run="${escapeHtml(actionableRunId)}">
                <div class="blocker-control-row">
                  <input
                    type="text"
                    data-run-target
                    placeholder="Target agent or escalation target"
                    value="${escapeHtml(blocker.escalatedTo || '')}"
                  >
                  <input
                    type="text"
                    data-run-reason
                    placeholder="Reason or operator note"
                    value="${escapeHtml(blocker.pauseReason || blocker.escalationReason || '')}"
                  >
                </div>
                <div class="blocker-action-row">
                  <button type="button" class="blocker-action-btn" data-run-action="reassign">Reassign</button>
                  <button type="button" class="blocker-action-btn" data-run-action="escalate">Escalate</button>
                  <button type="button" class="blocker-action-btn" data-run-action="pause">Pause</button>
                  <button type="button" class="blocker-action-btn" data-run-action="resume">Resume</button>
                </div>
              </div>
            ` : ''}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

async function handleRunAction(button) {
  const action = button.dataset.runAction;
  const shell = button.closest('[data-blocker-run]');
  if (!action || !shell) return;

  const runId = shell.dataset.blockerRun;
  const target = shell.querySelector('[data-run-target]')?.value?.trim() || '';
  const reason = shell.querySelector('[data-run-reason]')?.value?.trim() || '';
  let url = '';
  let payload = { actor: BLOCKER_ACTION_ACTOR };

  if (action === 'reassign') {
    if (!target) {
      showNotice('Enter a target agent id before reassigning a blocked run.');
      return;
    }
    url = `/api/workflow-runs/${runId}/reassign`;
    payload = {
      ...payload,
      new_owner_agent_id: target,
      reason
    };
  } else if (action === 'escalate') {
    url = `/api/workflow-runs/${runId}/escalate`;
    payload = {
      ...payload,
      escalated_to: target || null,
      reason
    };
  } else if (action === 'pause') {
    url = `/api/workflow-runs/${runId}/pause`;
    payload = {
      ...payload,
      reason
    };
  } else if (action === 'resume') {
    url = `/api/workflow-runs/${runId}/resume`;
    payload = {
      ...payload,
      note: reason
    };
  } else {
    return;
  }

  const buttons = Array.from(shell.querySelectorAll('[data-run-action]'));
  buttons.forEach((element) => { element.disabled = true; });

  try {
    await fetchJson(url, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showNotice(`${formatStatusLabel(action)} action applied to blocked run ${runId}.`);
    await fetchOverview({ silent: true });
  } catch (error) {
    console.error('[AgentsPage] Blocker action failed:', error);
    showNotice(error.message || 'Could not update blocked run state.');
  } finally {
    buttons.forEach((element) => { element.disabled = false; });
  }
}

function bindDetailActions() {
  dom.agentDetail.querySelectorAll('[data-run-action]').forEach((button) => {
    button.addEventListener('click', () => {
      handleRunAction(button);
    });
  });
}

function renderDetail(agent) {
  if (!agent) {
    dom.agentDetail.innerHTML = `
      <div class="detail-shell">
        <div class="detail-card">
          <h3>Agent detail</h3>
          <p class="empty-copy">Select an agent from the workspace to inspect its runtime and queue.</p>
        </div>
      </div>
    `;
    return;
  }

  const currentTask = agent.currentTask;
  const nextTask = agent.nextTask && agent.nextTask.id !== currentTask?.id ? agent.nextTask : null;
  const activity = agent.currentActivity || currentTask?.title || 'Waiting for a runnable task.';
  const department = getAgentDepartment(agent);
  const capabilityText = Array.isArray(agent.capabilities) && agent.capabilities.length
    ? agent.capabilities.join(', ')
    : 'No explicit capability metadata';
  const agentBlockers = getAgentBlockers(agent);

  dom.agentDetail.innerHTML = `
    <div class="detail-shell">
      <div class="detail-header">
        <div class="detail-hero">
          ${renderAvatar(agent.id, agent.presence)}
          <div class="detail-copy">
            <h2>${escapeHtml(agent.name)}</h2>
            <p>${escapeHtml(activity)}</p>
            <div class="detail-meta">
              <span class="presence-chip is-${escapeHtml(agent.presence)}">${escapeHtml(formatPresenceLabel(agent.presence))}</span>
              ${agent.default ? '<span class="meta-pill">Default agent</span>' : ''}
              ${department ? `<span class="meta-pill">${escapeHtml(department.name)}</span>` : ''}
              ${agent.role ? `<span class="meta-pill">${escapeHtml(agent.role)}</span>` : ''}
              ${agentBlockers.length ? `<span class="meta-pill">${escapeHtml(pluralize(agentBlockers.length, 'blocker'))}</span>` : ''}
              <span class="meta-pill">${escapeHtml(formatModel(agent.defaultModel))}</span>
            </div>
          </div>
        </div>
      </div>

      <section class="detail-card">
        <h3>Queue pressure</h3>
        <div class="detail-stats">
          <div class="detail-stat">
            <strong>${agent.queueSummary.ready || 0}</strong>
            <span>Ready</span>
          </div>
          <div class="detail-stat">
            <strong>${agent.queueSummary.inProgress || 0}</strong>
            <span>In flight</span>
          </div>
          <div class="detail-stat">
            <strong>${agent.queueSummary.overdue || 0}</strong>
            <span>Overdue</span>
          </div>
        </div>
      </section>

      <section class="detail-card">
        <h3>Current focus</h3>
        ${currentTask ? `
          <div class="queue-item">
            <div class="queue-item-top">
              <div class="queue-item-title">${escapeHtml(currentTask.title)}</div>
              <span class="presence-chip is-working">${escapeHtml(formatStatusLabel(currentTask.status))}</span>
            </div>
            <p class="queue-item-subtitle">${escapeHtml(currentTask.project_name || 'No project')}</p>
            <div class="queue-item-meta">
              ${currentTask.priority ? `<span class="meta-pill">${escapeHtml(currentTask.priority)}</span>` : ''}
              ${currentTask.preferred_model ? `<span class="meta-pill">${escapeHtml(formatModel(currentTask.preferred_model))}</span>` : ''}
            </div>
          </div>
        ` : `
          <div class="empty-state">
            <strong>No active task.</strong>
            <p class="empty-copy">The agent has not claimed an in-progress dashboard task yet.</p>
          </div>
        `}
      </section>

      <section class="detail-card">
        <h3>Next up</h3>
        ${nextTask ? `
          <div class="queue-item">
            <div class="queue-item-top">
              <div class="queue-item-title">${escapeHtml(nextTask.title)}</div>
              <span class="presence-chip is-${nextTask.status === 'blocked' ? 'queued' : 'idle'}">${escapeHtml(formatStatusLabel(nextTask.status))}</span>
            </div>
            <p class="queue-item-subtitle">${escapeHtml(nextTask.project_name || 'No project')}</p>
          </div>
        ` : `
          <div class="empty-state">
            <strong>No queued follow-up.</strong>
            <p class="empty-copy">Once new dashboard tasks are routed here, they will appear in this panel.</p>
          </div>
        `}
      </section>

      <section class="detail-card">
        <h3>Queue preview</h3>
        ${renderQueueItems(agent.queue)}
      </section>

      <section class="detail-card">
        <h3>Blocker console</h3>
        ${renderBlockerConsole(agent)}
      </section>

      <section class="detail-card">
        <h3>Role profile</h3>
        <dl class="definition-list">
          <div>
            <dt>Department</dt>
            <dd>${escapeHtml(department?.name || 'Unassigned')}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>${escapeHtml(agent.role || 'Not defined')}</dd>
          </div>
          <div>
            <dt>Capabilities</dt>
            <dd>${escapeHtml(capabilityText)}</dd>
          </div>
          <div>
            <dt>Configured model</dt>
            <dd>${escapeHtml(formatModel(agent.defaultModel || agent.modelPrimary))}</dd>
          </div>
        </dl>
      </section>

      <section class="detail-card">
        <h3>Runtime detail</h3>
        <dl class="definition-list">
          <div>
            <dt>Workspace</dt>
            <dd>${escapeHtml(agent.workspace || 'Workspace not declared')}</dd>
          </div>
          <div>
            <dt>Last heartbeat</dt>
            <dd>${escapeHtml(formatTimestamp(agent.lastSeenAt))} (${escapeHtml(formatRelative(agent.lastSeenAt))})</dd>
          </div>
          <div>
            <dt>Bridge status</dt>
            <dd>${escapeHtml(agent.status || 'offline')}</dd>
          </div>
          <div>
            <dt>Runtime source</dt>
            <dd>${escapeHtml(agent.runtime?.source || 'No runtime source recorded')}</dd>
          </div>
          <div>
            <dt>Queue snapshot</dt>
            <dd>${escapeHtml(`${agent.runtime?.queueReadyCount || 0} ready / ${agent.runtime?.queueActiveCount || 0} active`)}</dd>
          </div>
        </dl>
      </section>
    </div>
  `;

  bindDetailActions();
}

function renderSummary(overview) {
  const summary = overview?.summary || {};
  const blockerSummary = getBlockerSummary();
  const departmentCount = new Set(
    (overview?.agents || [])
      .map((agent) => getAgentDepartment(agent)?.slug || 'unassigned')
  ).size;
  const filterContext = state.presenceFilter === 'all'
    ? 'all configured agents'
    : `${formatPresenceLabel(state.presenceFilter).toLowerCase()} agents`;
  const blockerFragment = blockerSummary.total
    ? ` There are ${blockerSummary.total} active blockers across ${blockerSummary.byDepartment.length || departmentCount} departments.`
    : ' No active blockers are currently classified.';
  dom.workspaceSummary.textContent = `${summary.totalAgents || 0} configured agents across ${departmentCount} departments. Use search and presence filters to isolate ${filterContext}, then inspect the selected runtime on the right.${blockerFragment}`;
}

function buildSummaryFromAgents(agents = []) {
  return agents.reduce((summary, agent) => {
    summary.totalAgents += 1;
    summary.readyTasks += Number(agent.queueSummary?.ready) || 0;
    summary.activeTasks += Number(agent.queueSummary?.inProgress) || 0;
    summary.blockedTasks += Number(agent.queueSummary?.blocked) || 0;
    summary.overdueTasks += Number(agent.queueSummary?.overdue) || 0;

    if (agent.presence === 'working') summary.working += 1;
    if (agent.presence === 'queued') summary.queued += 1;
    if (agent.presence === 'idle') summary.idle += 1;
    if (agent.online) summary.online += 1;
    if (agent.presence === 'offline') summary.offline += 1;

    return summary;
  }, {
    totalAgents: 0,
    online: 0,
    working: 0,
    queued: 0,
    idle: 0,
    offline: 0,
    readyTasks: 0,
    activeTasks: 0,
    blockedTasks: 0,
    overdueTasks: 0
  });
}

function render() {
  const overview = state.overview || { summary: {}, agents: [] };
  const allAgents = overview.agents || [];
  const filteredAgents = filterAgents(allAgents);
  chooseSelectedAgent(filteredAgents);
  const selectedAgent = filteredAgents.find((agent) => agent.id === state.selectedAgentId) || null;
  renderMetrics(overview.summary);
  renderHeroPulse(overview, filteredAgents);
  renderHeroFocus(selectedAgent, filteredAgents, allAgents);
  renderSummary(overview);
  renderWorkspaceResults(filteredAgents, allAgents);
  updatePresenceFilterUi();
  renderZones(filteredAgents);
  renderDetail(selectedAgent);
}

async function fetchOverview({ silent = false } = {}) {
  if (state.isLoading) return;
  state.isLoading = true;
  dom.refreshState.textContent = silent ? 'Refreshing in background...' : 'Loading workspace...';

  try {
    const agents = await fetchJson('/api/org/agents?queue_limit=5');
    const [blockersResult, summaryResult] = await Promise.allSettled([
      fetchJson('/api/blockers?limit=200'),
      fetchJson('/api/blockers/summary?limit=200')
    ]);

    state.blockers = blockersResult.status === 'fulfilled'
      ? (blockersResult.value.blockers || [])
      : [];
    state.blockerSummary = summaryResult.status === 'fulfilled'
      ? summaryResult.value
      : emptyBlockerSummary();

    if (blockersResult.status === 'rejected') {
      console.warn('[AgentsPage] Failed to load blockers list:', blockersResult.reason);
    }
    if (summaryResult.status === 'rejected') {
      console.warn('[AgentsPage] Failed to load blocker summary:', summaryResult.reason);
    }

    const overview = {
      generatedAt: new Date().toISOString(),
      summary: buildSummaryFromAgents(agents),
      agents
    };
    state.overview = overview;
    showNotice('');
    render();
    dom.lastUpdated.textContent = `Updated ${formatTimestamp(overview.generatedAt)}`;
    dom.refreshState.textContent = 'Auto-refresh every 30 seconds';
  } catch (error) {
    console.error('[AgentsPage] Failed to load org overview:', error);
    dom.refreshState.textContent = 'Refresh failed';
    showNotice('Could not load OpenClaw org overview. Check that the dashboard API is running.');
  } finally {
    state.isLoading = false;
  }
}

function bindEvents() {
  dom.themeToggle?.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    persistTheme(state.theme);
  });

  dom.refreshBtn?.addEventListener('click', () => {
    fetchOverview();
  });

  dom.agentSearchInput?.addEventListener('input', (event) => {
    state.search = event.target.value || '';
    saveUiState();
    render();
  });

  dom.presenceFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-presence]');
    if (!button) return;
    state.presenceFilter = button.dataset.presence || 'all';
    saveUiState();
    render();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      fetchOverview({ silent: true });
    }
  });
}

function startPolling() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    fetchOverview({ silent: true });
  }, POLL_INTERVAL_MS);
}

function init() {
  const persisted = loadUiState();
  state.selectedAgentId = persisted.selectedAgentId || null;
  state.search = persisted.search || '';
  state.presenceFilter = persisted.presenceFilter || 'all';
  if (dom.agentSearchInput) {
    dom.agentSearchInput.value = state.search;
  }
  applyTheme(state.theme);
  bindEvents();
  render();
  fetchOverview();
  startPolling();
}

init();

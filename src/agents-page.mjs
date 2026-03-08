const POLL_INTERVAL_MS = 30 * 1000;
const UI_STATE_KEY = 'openclawAgentsPageState';
const DASHBOARD_STATE_KEY = 'projectDashboardState';

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
  selectedAgentId: null,
  theme: loadInitialTheme(),
  search: '',
  presenceFilter: 'all',
  isLoading: false,
  refreshTimer: null
};

const ZONE_ORDER = [
  'core-command',
  'operations',
  'feature-dev',
  'bug-fix',
  'security-audit',
  'specialist-workspaces',
  'other'
];

const ZONES = {
  'core-command': {
    title: 'Core command',
    description: 'Primary OpenClaw control loops and top-level orchestration.'
  },
  'operations': {
    title: 'Operations agents',
    description: 'General-purpose workspace agents covering recurring dashboard and content work.'
  },
  'feature-dev': {
    title: 'Feature development',
    description: 'Workflow specialists used for feature planning, implementation, testing, and review.'
  },
  'bug-fix': {
    title: 'Bug fix workflow',
    description: 'Investigation, fix, and verification roles dedicated to issue handling.'
  },
  'security-audit': {
    title: 'Security audit workflow',
    description: 'Scanning, prioritization, fixing, and test roles for security-focused work.'
  },
  'specialist-workspaces': {
    title: 'Specialist workspaces',
    description: 'Domain-specific agents tied to dedicated workspaces and projects.'
  },
  other: {
    title: 'Other agents',
    description: 'Configured agents that do not fit the main workspace clusters yet.'
  }
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
  dom.themeToggle.textContent = isDark ? 'Light mode' : 'Dark mode';
  dom.themeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
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

function buildAgentZone(agent) {
  const id = agent.id || '';
  const workspace = agent.workspace || '';

  if (agent.default || id === 'main') return 'core-command';
  if (id.startsWith('feature-dev_') || workspace.includes('/workflows/feature-dev/')) return 'feature-dev';
  if (id.startsWith('bug-fix_') || workspace.includes('/workflows/bug-fix/')) return 'bug-fix';
  if (id.startsWith('security-audit_') || workspace.includes('/workflows/security-audit/')) return 'security-audit';
  if (workspace && workspace !== '/root/.openclaw/workspace') return 'specialist-workspaces';
  if (workspace === '/root/.openclaw/workspace' || !workspace) return 'operations';
  return 'other';
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
    const zoneKey = buildAgentZone(agent);
    if (!grouped.has(zoneKey)) grouped.set(zoneKey, []);
    grouped.get(zoneKey).push(agent);
  });

  return ZONE_ORDER
    .filter((zoneKey) => grouped.has(zoneKey))
    .map((zoneKey) => {
      const items = grouped.get(zoneKey).slice().sort((left, right) => {
        const presenceDelta = getPresenceWeight(left.presence) - getPresenceWeight(right.presence);
        if (presenceDelta !== 0) return presenceDelta;
        const workDelta = (right.queueSummary?.ready || 0) - (left.queueSummary?.ready || 0);
        if (workDelta !== 0) return workDelta;
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      });
      return {
        key: zoneKey,
        ...ZONES[zoneKey],
        agents: items
      };
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
    agent.id,
    agent.workspace,
    agent.defaultModel,
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

  if (!highlightedAgents.length) {
    dom.heroPulseList.innerHTML = `
      <div class="empty-state">
        <strong>No agent telemetry yet.</strong>
        <p class="empty-copy">When OpenClaw agents send dashboard bridge heartbeats, their live state will appear here.</p>
      </div>
    `;
    return;
  }

  dom.heroPulseList.innerHTML = highlightedAgents.map((agent) => {
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
  }).join('');
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

  dom.agentZones.innerHTML = groups.map((group) => `
    <section class="zone-block">
      <div class="zone-header">
        <div>
          <h3>${escapeHtml(group.title)}</h3>
          <p>${escapeHtml(group.description)}</p>
        </div>
        <div class="zone-tally">${group.agents.length} agents</div>
      </div>
      <div class="zone-grid">
        ${group.agents.map((agent) => {
          const isSelected = agent.id === state.selectedAgentId;
          const activity = agent.currentActivity || agent.currentTask?.title || 'Waiting for a new task.';
          const compactModel = formatModelCompact(agent.defaultModel);
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
                  <div class="agent-subtitle" title="${escapeHtml(agent.workspace || 'Workspace not declared')}">${escapeHtml(formatWorkspacePath(agent.workspace))}</div>
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
  `).join('');

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
}

function renderSummary(overview) {
  const summary = overview?.summary || {};
  const filterContext = state.presenceFilter === 'all'
    ? 'all configured agents'
    : `${formatPresenceLabel(state.presenceFilter).toLowerCase()} agents`;
  dom.workspaceSummary.textContent = `${summary.totalAgents || 0} configured agents in OpenClaw. Use search and presence filters to isolate ${filterContext}, then inspect the selected runtime on the right.`;
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
    const response = await fetch('/api/agents/overview?queue_limit=5', {
      headers: {
        Accept: 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const overview = await response.json();
    state.overview = overview;
    showNotice('');
    render();
    dom.lastUpdated.textContent = `Updated ${formatTimestamp(overview.generatedAt)}`;
    dom.refreshState.textContent = 'Auto-refresh every 30 seconds';
  } catch (error) {
    console.error('[AgentsPage] Failed to load overview:', error);
    dom.refreshState.textContent = 'Refresh failed';
    showNotice('Could not load OpenClaw agent overview. Check that the dashboard API is running.');
  } finally {
    state.isLoading = false;
  }
}

function bindEvents() {
  dom.themeToggle.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    persistTheme(state.theme);
  });

  dom.refreshBtn.addEventListener('click', () => {
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

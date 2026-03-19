// Operations Page Module
// System health, cron jobs, agent status, service requests, and metrics

const REFRESH_INTERVAL = 30000;
let noticeTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initTheme() {
  const toggle = document.getElementById('themeToggle');
  const icon = toggle?.querySelector('.theme-toggle-icon');
  const label = toggle?.querySelector('.theme-toggle-label');

  if (!toggle || !icon || !label) {
    console.warn('[Operations] Theme toggle elements not found');
    return;
  }

  const stored = localStorage.getItem('dashboard-theme');
  if (stored === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    icon.textContent = '☀️';
    label.textContent = 'Light';
    toggle.setAttribute('aria-pressed', 'true');
  }

  toggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('dashboard-theme', 'light');
      icon.textContent = '🌙';
      label.textContent = 'Dark';
      toggle.setAttribute('aria-pressed', 'false');
      return;
    }

    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('dashboard-theme', 'dark');
    icon.textContent = '☀️';
    label.textContent = 'Light';
    toggle.setAttribute('aria-pressed', 'true');
  });
}

async function api(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}`);
  }
  return response.json();
}

function showNotice(message, type = 'info') {
  const el = document.getElementById('notice');
  if (!el) return;

  el.textContent = message || '';
  el.className = `notice${message ? ' is-visible' : ''}${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
  clearTimeout(noticeTimer);

  if (message) {
    noticeTimer = setTimeout(() => {
      el.className = 'notice';
      el.textContent = '';
    }, 3600);
  }
}

function formatDateTime(value, fallback = 'Unknown') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

function formatDateOnly(value, fallback = 'Unknown') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString();
}

function formatCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : String(value ?? '0');
}

function metricValue(value) {
  if (value === null || value === undefined) return '0';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
  }
  return String(value);
}

async function fetchHealth() {
  return api('/api/health-status');
}

function renderHealth(data) {
  const grid = document.getElementById('healthGrid');
  if (!grid) return;

  const items = [
    {
      label: 'Dashboard',
      state: data?.task_server?.healthy ? 'healthy' : 'critical',
      value: data?.task_server?.healthy ? 'Healthy' : 'Unavailable'
    },
    {
      label: 'Database',
      state: data?.database?.status === 'connected' ? 'healthy' : 'critical',
      value: data?.database?.status === 'connected' ? 'Connected' : 'Disconnected'
    },
    {
      label: 'Gateway',
      state: data?.gateway?.status === 'running' ? 'healthy' : data?.gateway?.status === 'unknown' ? 'warning' : 'critical',
      value: data?.gateway?.status ? String(data.gateway.status).replace(/_/g, ' ') : 'Unknown'
    }
  ];

  grid.innerHTML = items.map((item) => `
    <div class="health-item ${item.state}">
      <div class="label">${escapeHtml(item.label)}</div>
      <div class="value">${escapeHtml(item.value)}</div>
    </div>
  `).join('');
}

async function fetchCronJobs() {
  const data = await api('/api/cron/jobs');
  return Array.isArray(data?.jobs) ? data.jobs : [];
}

function renderCronJobs(jobs) {
  const container = document.getElementById('cronList');
  if (!container) return;

  if (!Array.isArray(jobs) || jobs.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📭</div>No cron jobs configured</div>';
    return;
  }

  container.innerHTML = jobs.slice(0, 6).map((job) => `
    <div class="cron-item">
      <div class="info">
        <div class="job-id">${escapeHtml(job.name || job.id || 'Unnamed job')}</div>
        <div class="schedule">${escapeHtml(job.schedule || 'No schedule')}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:700; text-transform:capitalize;">${escapeHtml(job.status || 'unknown')}</div>
        <div style="font-size:0.78rem; color:var(--muted);">${escapeHtml(formatDateTime(job.lastRun, 'Never'))}</div>
      </div>
    </div>
  `).join('');
}

async function fetchAgentStatus() {
  const data = await api('/api/org/agents');
  return Array.isArray(data) ? data : Array.isArray(data?.agents) ? data.agents : [];
}

function agentPulseClass(agent) {
  if (agent?.online && agent?.presence === 'working') return 'active';
  if (agent?.online && agent?.presence !== 'offline') return 'idle';
  return 'stale';
}

function renderAgentStatus(agents) {
  const container = document.getElementById('agentsList');
  if (!container) return;

  if (!Array.isArray(agents) || agents.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">🤖</div>No agents found</div>';
    return;
  }

  container.className = 'agent-list';
  container.innerHTML = agents.slice(0, 6).map((agent) => {
    const displayName = agent.displayName || agent.name || agent.agentId || agent.id || 'Unknown agent';
    const subtitleParts = [];
    if (agent.role) subtitleParts.push(agent.role);
    if (agent.presence) subtitleParts.push(String(agent.presence).replace(/_/g, ' '));
    const lastSeen = agent.lastSeenAt || agent.lastHeartbeat || null;

    return `
      <div class="agent-item">
        <div class="agent-pulse ${agentPulseClass(agent)}" aria-hidden="true"></div>
        <div class="agent-name">
          <div>${escapeHtml(displayName)}</div>
          <div class="agent-seen">${escapeHtml(subtitleParts.join(' · ') || 'No presence data')}</div>
        </div>
        <div class="agent-seen">${escapeHtml(formatDateTime(lastSeen))}</div>
      </div>
    `;
  }).join('');
}

async function fetchServiceRequests() {
  const data = await api('/api/service-requests?limit=25');
  return Array.isArray(data?.serviceRequests) ? data.serviceRequests : Array.isArray(data?.requests) ? data.requests : [];
}

function statusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (['completed', 'approved'].includes(normalized)) return 'success';
  if (['failed', 'rejected', 'cancelled'].includes(normalized)) return 'danger';
  if (['running', 'in_progress', 'queued'].includes(normalized)) return 'info';
  return 'warning';
}

function normalizeRequester(request) {
  return request?.requestedBy || request?.requested_by || request?.requester || 'Unknown';
}

function renderServiceRequests(requests) {
  const container = document.getElementById('servicesList');
  if (!container) return;

  if (!Array.isArray(requests) || requests.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📨</div>No service requests</div>';
    return;
  }

  container.innerHTML = `
    <table class="ops-table">
      <thead>
        <tr>
          <th>Request</th>
          <th>Requester</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        ${requests.slice(0, 6).map((request) => `
          <tr>
            <td>
              <div class="name">${escapeHtml(request.title || request.service?.name || 'Untitled request')}</div>
              <div style="font-size:0.8rem; color:var(--muted);">${escapeHtml(request.service?.name || request.serviceName || request.service_id || 'No service')}</div>
            </td>
            <td>${escapeHtml(normalizeRequester(request))}</td>
            <td><span class="badge badge-${statusTone(request.status)}">${escapeHtml(request.status || 'unknown')}</span></td>
            <td>${escapeHtml(formatDateOnly(request.createdAt || request.created_at))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function fetchMetrics() {
  const data = await api('/api/metrics/org');
  return data?.scorecard || {};
}

function renderMetrics(metrics) {
  const container = document.getElementById('metricsContent');
  if (!container) return;

  if (!metrics || Object.keys(metrics).length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📊</div>No metrics available</div>';
    return;
  }

  const highlights = [
    { label: 'Workflow Runs Started', value: metrics.workflowRunsStarted || 0 },
    { label: 'Workflow Runs Completed', value: metrics.workflowRunsCompleted || 0 },
    { label: 'Workflow Success Rate', value: metrics.workflowSuccessRate == null ? 'n/a' : `${metricValue(metrics.workflowSuccessRate)}%` },
    { label: 'Active Workload', value: metrics.activeWorkload || 0 }
  ];

  const tracked = [
    ['Departments Tracked', metrics.departmentsTracked || 0],
    ['Agents Tracked', metrics.agentsTracked || 0],
    ['Services Tracked', metrics.servicesTracked || 0],
    ['Sites Tracked', metrics.sitesTracked || 0]
  ];

  const maxTracked = Math.max(...tracked.map(([, value]) => Number(value) || 0), 1);

  container.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:16px;">
      ${highlights.map((item) => `
        <div style="padding:14px; border:1px solid var(--border); border-radius:12px; background:var(--surface-2);">
          <div style="font-size:0.78rem; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted);">${escapeHtml(item.label)}</div>
          <div style="margin-top:8px; font-size:1.7rem; font-weight:700;">${escapeHtml(metricValue(item.value))}</div>
        </div>
      `).join('')}
    </div>
    ${tracked.map(([label, value]) => `
      <div class="metric-bar-container">
        <div class="metric-bar-label">
          <span class="agent">${escapeHtml(label)}</span>
          <span class="count">${escapeHtml(formatCount(value))}</span>
        </div>
        <div class="metric-bar-track">
          <div class="metric-bar-fill" style="width:${Math.max(8, Math.round(((Number(value) || 0) / maxTracked) * 100))}%;"></div>
        </div>
      </div>
    `).join('')}
  `;
}

async function loadAll() {
  const healthGrid = document.getElementById('healthGrid');
  const cronList = document.getElementById('cronList');
  const agentsList = document.getElementById('agentsList');
  const servicesList = document.getElementById('servicesList');
  const metricsContent = document.getElementById('metricsContent');

  const results = await Promise.allSettled([
    fetchHealth(),
    fetchCronJobs(),
    fetchAgentStatus(),
    fetchServiceRequests(),
    fetchMetrics()
  ]);

  const [healthRes, cronRes, agentRes, requestsRes, metricsRes] = results;

  if (healthRes.status === 'fulfilled') {
    renderHealth(healthRes.value);
  } else if (healthGrid) {
    healthGrid.innerHTML = '<div class="empty-state"><div class="icon">🏥</div>Health data unavailable</div>';
  }

  if (cronRes.status === 'fulfilled') {
    renderCronJobs(cronRes.value);
  } else if (cronList) {
    cronList.innerHTML = '<div class="empty-state"><div class="icon">⏱</div>Cron jobs unavailable</div>';
  }

  if (agentRes.status === 'fulfilled') {
    renderAgentStatus(agentRes.value);
  } else if (agentsList) {
    agentsList.innerHTML = '<div class="empty-state"><div class="icon">🤖</div>Agent status unavailable</div>';
  }

  if (requestsRes.status === 'fulfilled') {
    renderServiceRequests(requestsRes.value);
  } else if (servicesList) {
    servicesList.innerHTML = '<div class="empty-state"><div class="icon">📨</div>Service requests unavailable</div>';
  }

  if (metricsRes.status === 'fulfilled') {
    renderMetrics(metricsRes.value);
  } else if (metricsContent) {
    metricsContent.innerHTML = '<div class="empty-state"><div class="icon">📊</div>Metrics unavailable</div>';
  }

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) {
    showNotice(`Failed to load ${failures.length} data source(s).`, 'error');
  }
}

initTheme();
loadAll().catch((error) => {
  console.error('[Operations] Initial load failed:', error);
  showNotice('Failed to initialize Operations.', 'error');
});

const refreshBtn = document.getElementById('refreshBtn');
refreshBtn?.addEventListener('click', () => {
  showNotice('Refreshing operations data...');
  loadAll()
    .then(() => showNotice('Operations data refreshed.', 'success'))
    .catch((error) => {
      console.error('[Operations] Refresh failed:', error);
      showNotice('Failed to refresh operations data.', 'error');
    });
});

setInterval(() => {
  loadAll().catch(() => {
    // Silent background refresh failure.
  });
}, REFRESH_INTERVAL);

// Workflows Page Module
// Workflow templates, active runs, stuck runs, and execution history
// Supports starting workflows with custom prompts and viewing run results

const REFRESH_INTERVAL = 30000;
let currentFilter = 'all';
let allRuns = [];
let activeRuns = [];
let stuckRuns = [];
let templates = [];
let lastRunsByTemplate = {};
let runsByTemplate = {};
let noticeTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJson(value) {
  if (!value) return '';
  return JSON.stringify(value, null, 2)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function initTheme() {
  const toggle = document.getElementById('themeToggle');
  const icon = toggle?.querySelector('.theme-toggle-icon');
  const label = toggle?.querySelector('.theme-toggle-label');

  if (!toggle || !icon || !label) {
    console.warn('[Workflows] Theme toggle elements not found');
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${path} -> ${response.status}: ${text.slice(0, 200)}`);
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

function initFilters() {
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) return;

  toolbar.addEventListener('click', (event) => {
    const btn = event.target.closest('.filter-btn');
    if (!btn) return;

    document.querySelectorAll('.filter-btn').forEach((button) => button.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter || 'all';
    renderRuns();
  });
}

function normalizeRunName(run) {
  return run.displayName
    || run.template?.displayName
    || run.template_name
    || run.workflowType
    || run.workflow_type
    || run.workflow_name
    || run.name
    || 'Unnamed run';
}

function normalizeRunOwner(run) {
  return run.ownerAgentId
    || run.owner_agent_id
    || run.agent
    || run.owner
    || 'Unassigned';
}

function normalizeRunStep(run) {
  return run.currentStep || run.current_step || run.step || null;
}

function normalizeRunStart(run) {
  return run.startedAt || run.started_at || run.createdAt || run.created_at || null;
}

function normalizeRunEnd(run) {
  return run.finishedAt || run.finished_at || run.updatedAt || run.updated_at || null;
}

function statusBadge(status) {
  const normalized = String(status || 'unknown').toLowerCase();
  const tone = {
    queued: 'neutral',
    running: 'info',
    waiting_for_approval: 'warning',
    blocked: 'warning',
    retrying: 'warning',
    completed: 'success',
    failed: 'danger',
    cancelled: 'neutral'
  }[normalized] || 'neutral';

  return `<span class="badge badge-${tone}">${escapeHtml(status || 'unknown')}</span>`;
}

function timeAgo(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(run) {
  const started = normalizeRunStart(run);
  const ended = normalizeRunEnd(run);
  if (!started || !ended) return '—';

  const durationMs = new Date(ended).getTime() - new Date(started).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return '—';
  if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`;
  if (durationMs < 3600000) return `${Math.round(durationMs / 60000)}m`;
  return `${(durationMs / 3600000).toFixed(1)}h`;
}

function activeRunStatus(status) {
  return ['queued', 'running', 'retrying', 'waiting_for_approval', 'blocked'].includes(String(status || '').toLowerCase());
}

function isHistoricalRun(status) {
  return ['completed', 'failed', 'cancelled'].includes(String(status || '').toLowerCase());
}

function filterRuns(runs) {
  if (currentFilter === 'all') return runs;
  if (currentFilter === 'running') return runs.filter((run) => activeRunStatus(run.status));
  if (currentFilter === 'completed') return runs.filter((run) => ['completed', 'cancelled'].includes(String(run.status || '').toLowerCase()));
  if (currentFilter === 'failed') return runs.filter((run) => String(run.status || '').toLowerCase() === 'failed');
  return runs;
}

function renderRunItem(run, { stuck = false } = {}) {
  const started = normalizeRunStart(run);
  const step = normalizeRunStep(run);
  const templateRef = run.template?.displayName || run.template?.name || run.template_name || '';

  return `
    <div class="wf-run${stuck ? ' stuck' : ''}">
      <div class="wf-run-header">
        <span class="wf-run-name">${escapeHtml(normalizeRunName(run))}</span>
        ${statusBadge(run.status)}
      </div>
      <div class="wf-run-meta">
        <span>ID: ${escapeHtml((run.id || '').slice(0, 8) || 'n/a')}</span>
        ${started ? `<span>${escapeHtml(timeAgo(started))}</span>` : ''}
        <span>Owner: ${escapeHtml(normalizeRunOwner(run))}</span>
      </div>
      ${templateRef ? `<div class="wf-run-step"><span class="step-label">Template:</span> ${escapeHtml(templateRef)}</div>` : ''}
      ${step ? `<div class="wf-run-step"><span class="step-label">Step:</span> ${escapeHtml(step)}</div>` : ''}
      ${stuck && run.blockerType ? `<div class="wf-run-step"><span class="step-label">Blocker:</span> ${escapeHtml(run.blockerType)}</div>` : ''}
    </div>
  `;
}

function renderActiveRuns(runs) {
  const container = document.getElementById('activeRunsList');
  if (!container) return;

  const items = filterRuns(runs).filter((run) => activeRunStatus(run.status));
  if (!items.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">✅</div>No active workflow runs</div>';
    return;
  }

  container.innerHTML = items.map((run) => renderRunItem(run)).join('');
}

function renderStuckRuns(runs) {
  const container = document.getElementById('stuckRunsList');
  if (!container) return;

  const items = filterRuns(runs);
  if (!items.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">🧭</div>No stuck workflow runs</div>';
    return;
  }

  container.innerHTML = items.map((run) => renderRunItem(run, { stuck: true })).join('');
}

function renderRecentRuns(runs) {
  const container = document.getElementById('recentRunsList');
  if (!container) return;

  const items = filterRuns(runs)
    .filter((run) => isHistoricalRun(run.status))
    .sort((left, right) => new Date(normalizeRunEnd(right) || 0) - new Date(normalizeRunEnd(left) || 0))
    .slice(0, 50);

  if (!items.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📭</div>No completed workflow runs yet</div>';
    return;
  }

  container.innerHTML = `
    <table class="ops-table" style="width:100%; border-collapse:collapse; font-size:0.88rem;">
      <thead>
        <tr style="text-align:left; border-bottom:2px solid var(--border);">
          <th style="padding:8px 10px; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted);">Workflow</th>
          <th style="padding:8px 10px; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted);">Status</th>
          <th style="padding:8px 10px; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted);">Owner</th>
          <th style="padding:8px 10px; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted);">Finished</th>
          <th style="padding:8px 10px; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted);">Duration</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((run) => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:10px; font-weight:600;">${escapeHtml(normalizeRunName(run))}</td>
            <td style="padding:10px;">${statusBadge(run.status)}</td>
            <td style="padding:10px; color:var(--muted);">${escapeHtml(normalizeRunOwner(run))}</td>
            <td style="padding:10px; color:var(--muted);">${escapeHtml(timeAgo(normalizeRunEnd(run)) || '—')}</td>
            <td style="padding:10px; color:var(--muted);">${escapeHtml(formatDuration(run))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function computeLastRunsByTemplate(runs) {
  const byTemplate = {};
  
  for (const run of runs) {
    const workflowType = run.workflow_type || run.workflowType;
    if (!workflowType) continue;
    
    const existing = byTemplate[workflowType];
    const runTime = new Date(normalizeRunEnd(run) || normalizeRunStart(run) || 0).getTime();
    
    if (!existing || runTime > (existing.time || 0)) {
      byTemplate[workflowType] = {
        run,
        time: runTime,
        status: run.status,
        finishedAt: normalizeRunEnd(run),
        startedAt: normalizeRunStart(run)
      };
    }
  }
  
  return byTemplate;
}

function computeRunsByTemplate(runs) {
  const byTemplate = {};
  
  for (const run of runs) {
    const workflowType = run.workflow_type || run.workflowType;
    if (!workflowType) continue;
    
    if (!byTemplate[workflowType]) {
      byTemplate[workflowType] = [];
    }
    byTemplate[workflowType].push(run);
  }
  
  // Sort each template's runs by finished_at descending
  for (const workflowType in byTemplate) {
    byTemplate[workflowType].sort((a, b) => {
      const aTime = new Date(normalizeRunEnd(a) || normalizeRunStart(a) || 0).getTime();
      const bTime = new Date(normalizeRunEnd(b) || normalizeRunStart(b) || 0).getTime();
      return bTime - aTime;
    });
  }
  
  return byTemplate;
}

function renderRunResults(run, index) {
  const runId = run.id || 'unknown';
  const status = run.status || 'unknown';
  const finishedAt = normalizeRunEnd(run);
  const outputSummary = run.output_summary || run.outputSummary || {};
  const operatorNotes = run.operator_notes || run.operatorNotes || '';
  const steps = run.steps || [];
  const inputPayload = run.input_payload || run.inputPayload || {};
  
  // Build output summary display
  let outputHtml = '';
  if (outputSummary && Object.keys(outputSummary).length > 0) {
    outputHtml = `
      <div class="result-section">
        <div class="result-label">Output Summary</div>
        <div class="result-content">${renderJsonOutput(outputSummary)}</div>
      </div>
    `;
  }
  
  // Build operator notes display (this is the agent's full report)
  let notesHtml = '';
  if (operatorNotes) {
    notesHtml = `
      <div class="result-section">
        <div class="result-label">Agent Report</div>
        <div class="result-content agent-report">${escapeHtml(operatorNotes)}</div>
      </div>
    `;
  }
  
  // Build steps display
  let stepsHtml = '';
  if (steps.length > 0) {
    const completedSteps = steps.filter(s => s.status === 'completed' && s.output && Object.keys(s.output).length > 0);
    if (completedSteps.length > 0) {
      stepsHtml = `
        <div class="result-section">
          <div class="result-label">Step Outputs</div>
          <div class="steps-output">
            ${completedSteps.map(step => `
              <div class="step-output">
                <div class="step-name">${escapeHtml(step.display_name || step.step_name || step.name || 'Unknown step')}</div>
                <div class="step-content">${renderJsonOutput(step.output)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
  }
  
  // Build input payload display
  let inputHtml = '';
  if (inputPayload && Object.keys(inputPayload).length > 0) {
    inputHtml = `
      <div class="result-section result-section-collapsible" data-collapsed="true">
        <div class="result-label clickable" onclick="this.parentElement.dataset.collapsed = this.parentElement.dataset.collapsed === 'true' ? 'false' : 'true'">
          <span class="collapse-icon">▶</span> Input
        </div>
        <div class="result-content collapsed">${renderJsonOutput(inputPayload)}</div>
      </div>
    `;
  }
  
  const hasResults = outputHtml || notesHtml || stepsHtml || inputHtml;
  
  return `
    <div class="run-result-item" data-run-id="${escapeHtml(runId)}">
      <div class="run-result-header" onclick="toggleRunResult('${escapeHtml(runId)}')">
        <div class="run-result-title">
          <span class="collapse-icon">▶</span>
          <span class="run-result-id">${escapeHtml(runId.slice(0, 8))}</span>
          ${statusBadge(status)}
          <span class="run-result-time">${escapeHtml(timeAgo(finishedAt) || 'running')}</span>
        </div>
        <div class="run-result-duration">${escapeHtml(formatDuration(run))}</div>
      </div>
      <div class="run-result-body collapsed">
        ${hasResults ? `
          ${outputHtml}
          ${notesHtml}
          ${stepsHtml}
          ${inputHtml}
        ` : '<div class="no-results">No results recorded yet</div>'}
      </div>
    </div>
  `;
}

function renderJsonOutput(obj) {
  if (!obj || typeof obj !== 'object') {
    return escapeHtml(String(obj || ''));
  }
  
  // Check for special display patterns
  if (obj.live_url) {
    return `<a href="${escapeHtml(obj.live_url)}" target="_blank" class="result-link">${escapeHtml(obj.live_url)}</a>`;
  }
  
  // Generic JSON display
  const entries = Object.entries(obj);
  if (entries.length === 0) return '<span class="empty-value">—</span>';
  
  return entries.map(([key, value]) => {
    let valueDisplay;
    if (value === null || value === undefined) {
      valueDisplay = '<span class="empty-value">—</span>';
    } else if (typeof value === 'boolean') {
      valueDisplay = value ? '<span class="bool-true">✓ true</span>' : '<span class="bool-false">✗ false</span>';
    } else if (typeof value === 'object') {
      valueDisplay = `<code class="json-value">${escapeJson(value)}</code>`;
    } else if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
      valueDisplay = `<a href="${escapeHtml(value)}" target="_blank" class="result-link">${escapeHtml(value)}</a>`;
    } else {
      valueDisplay = `<span class="scalar-value">${escapeHtml(String(value))}</span>`;
    }
    
    return `<div class="result-row"><span class="result-key">${escapeHtml(key)}:</span> ${valueDisplay}</div>`;
  }).join('');
}

function renderTemplates(templateList) {
  const container = document.getElementById('installedList');
  if (!container) return;

  if (!Array.isArray(templateList) || templateList.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📦</div>No workflow templates defined</div>';
    return;
  }

  container.innerHTML = `
    <div class="template-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(350px, 1fr)); gap:20px;">
      ${templateList.map((template) => {
        const name = template.displayName || template.name || template.template_name || 'Unnamed template';
        const workflowType = template.name || template.workflow_type || template.template_name;
        const description = template.description || template.summary || '';
        const category = template.category || template.uiCategory || template.type || 'general';
        const steps = Array.isArray(template.steps) ? template.steps.length : (template.stepsCount || '?');
        const lastRun = lastRunsByTemplate[workflowType];
        const templateRuns = runsByTemplate[workflowType] || [];
        
        let lastRunHtml = '';
        if (lastRun) {
          const statusClass = lastRun.status === 'completed' ? 'success' : 
                              lastRun.status === 'failed' ? 'danger' : 
                              lastRun.status === 'cancelled' ? 'neutral' : 'warning';
          lastRunHtml = `
            <div class="last-run-info">
              <div class="last-run-header">
                <span class="last-run-label">Last Run</span>
                <span class="last-run-status" style="color: var(--${statusClass});">${escapeHtml(lastRun.status || 'unknown')}</span>
              </div>
              <div class="last-run-time">${escapeHtml(timeAgo(lastRun.finishedAt || lastRun.startedAt) || 'unknown time')}</div>
            </div>
          `;
        } else {
          lastRunHtml = `<div class="last-run-info never-run">Never run</div>`;
        }
        
        // Build run results section
        let runResultsHtml = '';
        const completedRuns = templateRuns.filter(r => r.status === 'completed' || r.status === 'failed').slice(0, 5);
        if (completedRuns.length > 0) {
          runResultsHtml = `
            <div class="run-results-section">
              <div class="run-results-header" onclick="toggleRunResultsSection('${escapeHtml(workflowType)}')">
                <span class="collapse-icon">▶</span>
                <span>Run Results (${completedRuns.length})</span>
              </div>
              <div class="run-results-body collapsed" id="results-${escapeHtml(workflowType)}">
                ${completedRuns.map((run, i) => renderRunResults(run, i)).join('')}
              </div>
            </div>
          `;
        }

        return `
          <div class="template-card" data-template="${escapeHtml(workflowType)}" data-name="${escapeHtml(name)}">
            <div class="template-header">
              <div class="template-name">${escapeHtml(name)}</div>
            </div>
            <div class="template-desc">${escapeHtml(description.slice(0, 150))}${description.length > 150 ? '…' : ''}</div>
            <div class="template-meta">
              <span>${escapeHtml(category)}</span>
              <span>${escapeHtml(steps)} steps</span>
            </div>
            ${lastRunHtml}
            <div class="template-actions">
              <button class="start-btn" data-workflow-type="${escapeHtml(workflowType)}" data-template-name="${escapeHtml(name)}">
                ▶ Start Workflow
              </button>
            </div>
            ${runResultsHtml}
          </div>
        `;
      }).join('')}
    </div>
  `;
  
  // Attach click handlers to start buttons
  container.querySelectorAll('.start-btn').forEach(btn => {
    btn.addEventListener('click', () => openStartModal(btn.dataset.workflowType, btn.dataset.templateName));
  });
}

// Global functions for onclick handlers
window.toggleRunResult = function(runId) {
  const item = document.querySelector(`[data-run-id="${runId}"]`);
  if (!item) return;
  
  const body = item.querySelector('.run-result-body');
  const icon = item.querySelector('.run-result-header .collapse-icon');
  
  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    icon.textContent = '▼';
  } else {
    body.classList.add('collapsed');
    icon.textContent = '▶';
  }
};

window.toggleRunResultsSection = function(workflowType) {
  const body = document.getElementById(`results-${workflowType}`);
  const header = body?.previousElementSibling;
  const icon = header?.querySelector('.collapse-icon');
  
  if (!body) return;
  
  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    if (icon) icon.textContent = '▼';
  } else {
    body.classList.add('collapsed');
    if (icon) icon.textContent = '▶';
  }
};

function renderRuns() {
  renderActiveRuns(activeRuns.length ? activeRuns : allRuns);
  renderStuckRuns(stuckRuns);
  renderRecentRuns(allRuns);
}

// Modal handling
function openStartModal(workflowType, templateName) {
  const modal = document.getElementById('startModal');
  const title = document.getElementById('modalTitle');
  const subtitle = document.getElementById('modalSubtitle');
  const workflowTypeInput = document.getElementById('workflowType');
  
  if (!modal || !title || !subtitle || !workflowTypeInput) return;
  
  title.textContent = `Start: ${templateName || workflowType}`;
  subtitle.textContent = `Configure and launch the ${workflowType} workflow`;
  workflowTypeInput.value = workflowType;
  
  // Clear previous form values
  document.getElementById('workflowTitle').value = '';
  document.getElementById('workflowDescription').value = '';
  document.getElementById('workflowSite').value = '';
  document.getElementById('workflowKeyword').value = '';
  
  // Show/hide site field based on workflow type
  const siteGroup = document.getElementById('siteGroup');
  if (siteGroup) {
    siteGroup.style.display = workflowType.includes('article') || workflowType.includes('publish') ? 'block' : 'none';
  }
  
  modal.classList.add('active');
  document.getElementById('workflowTitle').focus();
}

function closeModal() {
  const modal = document.getElementById('startModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

async function submitWorkflow(event) {
  event.preventDefault();
  
  const submitBtn = document.getElementById('submitBtn');
  const workflowType = document.getElementById('workflowType').value;
  const title = document.getElementById('workflowTitle').value.trim();
  const description = document.getElementById('workflowDescription').value.trim();
  const site = document.getElementById('workflowSite').value;
  const keyword = document.getElementById('workflowKeyword').value.trim();
  
  if (!workflowType) {
    showNotice('No workflow type selected', 'error');
    return;
  }
  
  if (!title) {
    showNotice('Please enter a title or topic', 'error');
    return;
  }
  
  submitBtn.disabled = true;
  submitBtn.textContent = 'Starting...';
  
  try {
    const payload = {
      workflow_type: workflowType,
      input_payload: {
        title,
        description,
        site: site || undefined,
        keyword: keyword || undefined
      },
      initiator: 'dashboard-operator'
    };
    
    const result = await api('/api/workflow-runs', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    showNotice(`Workflow started: ${result.id?.slice(0, 8) || 'unknown'}`, 'success');
    closeModal();
    
    // Refresh the data to show the new run
    await loadAll();
    
  } catch (error) {
    console.error('[Workflows] Failed to start workflow:', error);
    showNotice(`Failed to start workflow: ${error.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Start Workflow';
  }
}

function initModal() {
  const modal = document.getElementById('startModal');
  const cancelBtn = document.getElementById('cancelBtn');
  const form = document.getElementById('startWorkflowForm');
  
  if (!modal) return;
  
  // Close on cancel button
  cancelBtn?.addEventListener('click', closeModal);
  
  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });
  
  // Handle form submission
  form?.addEventListener('submit', submitWorkflow);
}

async function loadAll() {
  const results = await Promise.allSettled([
    api('/api/workflow-runs?limit=100'),
    api('/api/workflow-runs/active'),
    api('/api/workflow-runs/stuck'),
    api('/api/workflow-templates')
  ]);

  const [runsRes, activeRes, stuckRes, templatesRes] = results;

  allRuns = runsRes.status === 'fulfilled'
    ? (runsRes.value.runs || runsRes.value.data || runsRes.value || [])
    : [];

  activeRuns = activeRes.status === 'fulfilled'
    ? (activeRes.value.runs || activeRes.value.data || activeRes.value || [])
    : [];

  stuckRuns = stuckRes.status === 'fulfilled'
    ? (stuckRes.value.runs || stuckRes.value.data || stuckRes.value || [])
    : [];

  if (!activeRuns.length) {
    activeRuns = allRuns.filter((run) => activeRunStatus(run.status));
  }

  stuckRuns.forEach((stuckRun) => {
    if (!allRuns.find((run) => run.id === stuckRun.id)) {
      allRuns.push(stuckRun);
    }
  });

  // Compute runs grouped by template
  lastRunsByTemplate = computeLastRunsByTemplate(allRuns);
  runsByTemplate = computeRunsByTemplate(allRuns);

  renderRuns();

  if (templatesRes.status === 'fulfilled') {
    templates = templatesRes.value.templates || templatesRes.value.data || templatesRes.value || [];
    renderTemplates(templates);
  } else {
    const container = document.getElementById('installedList');
    if (container) {
      container.innerHTML = '<div class="empty-state"><div class="icon">📦</div>Templates unavailable</div>';
    }
  }

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) {
    showNotice(`Failed to load ${failures.length} workflow data source(s).`, 'error');
  }
}

initTheme();
initFilters();
initModal();
loadAll().catch((error) => {
  console.error('[Workflows] Initial load failed:', error);
  showNotice('Failed to initialize Workflows.', 'error');
});

document.getElementById('refreshBtn')?.addEventListener('click', () => {
  showNotice('Refreshing workflow data...');
  loadAll()
    .then(() => showNotice('Workflow data refreshed.', 'success'))
    .catch((error) => {
      console.error('[Workflows] Refresh failed:', error);
      showNotice('Failed to refresh workflow data.', 'error');
    });
});

setInterval(() => {
  loadAll().catch(() => {
    // Silent background refresh failure.
  });
}, REFRESH_INTERVAL);

// Citation Queue Status
async function loadCitationQueue() {
  console.log("[CitationQueue] Loading citation queue...");
  try {
    const data = await api('/api/citation-queue/status');
    console.log("[CitationQueue] Data received:", data);
    renderCitationQueue(data);
  } catch (error) {
    console.error('[Workflows] Failed to load citation queue:', error);
    const container = document.getElementById('citationQueueList');
    if (container) {
      container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div>Failed to load citation queue</div>';
    }
  }
}

function renderCitationQueue(data) {
  const container = document.getElementById('citationQueueList');
  if (!container) return;

  if (!data || !data.success) {
    container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div>Citation queue unavailable</div>';
    return;
  }

  const sites = Object.entries(data).filter(([key]) => key !== 'success' && key !== 'timestamp');
  
  if (sites.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">✅</div>No sites in queue</div>';
    return;
  }

  const totalPending = sites.reduce((sum, [_, siteData]) => sum + (siteData.pending || 0), 0);
  const totalInProgress = sites.reduce((sum, [_, siteData]) => sum + (siteData.in_progress || 0), 0);
  const totalCompleted = sites.reduce((sum, [_, siteData]) => sum + (siteData.completed || 0), 0);

  container.innerHTML = `
    <div style="margin-bottom: 16px;">
      <table class="ops-table" style="width:100%; border-collapse:collapse; font-size:0.88rem;">
        <thead>
          <tr style="text-align:left; border-bottom:2px solid var(--border);">
            <th style="padding:8px 10px; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted);">Site</th>
            <th style="padding:8px 10px; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted);">Pending</th>
            <th style="padding:8px 10px; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted);">In Progress</th>
            <th style="padding:8px 10px; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted);">Completed</th>
            <th style="padding:8px 10px; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted);">Total</th>
          </tr>
        </thead>
        <tbody>
          ${sites.map(([siteName, siteData]) => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:10px; font-weight:600;">${escapeHtml(siteName)}</td>
              <td style="padding:10px;"><span class="badge badge-warning">${escapeHtml(siteData.pending || 0)}</span></td>
              <td style="padding:10px;"><span class="badge badge-info">${escapeHtml(siteData.in_progress || 0)}</span></td>
              <td style="padding:10px;"><span class="badge badge-success">${escapeHtml(siteData.completed || 0)}</span></td>
              <td style="padding:10px; color:var(--muted);">${escapeHtml(siteData.total || 0)}</td>
            </tr>
          `).join('')}
          <tr style="border-top:2px solid var(--border); font-weight:700;">
            <td style="padding:10px;">Total</td>
            <td style="padding:10px;"><span class="badge badge-warning">${escapeHtml(totalPending)}</span></td>
            <td style="padding:10px;"><span class="badge badge-info">${escapeHtml(totalInProgress)}</span></td>
            <td style="padding:10px;"><span class="badge badge-success">${escapeHtml(totalCompleted)}</span></td>
            <td style="padding:10px; color:var(--muted);">${escapeHtml(totalPending + totalInProgress + totalCompleted)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style="font-size:0.8rem; color:var(--muted); margin-top:8px;">
      <strong>Target:</strong> 30+ citations per article | <strong>Requirements:</strong> Quick Answer Box, 2-3 Tables, 5+ FAQs, 1,500+ words, 4-6 products
    </div>
  `;
}

// Load citation queue on initial load and refresh
loadCitationQueue();

// Also load citation queue when refresh button is clicked
const originalRefreshHandler = document.getElementById('refreshBtn')?.onclick;
document.getElementById('refreshBtn')?.addEventListener('click', () => {
  loadCitationQueue();
});

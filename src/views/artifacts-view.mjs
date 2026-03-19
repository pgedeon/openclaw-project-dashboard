export async function renderArtifactsView({
  state,
  mountNode,
  fetchImpl = fetch,
  escapeHtml,
  showNotice,
  showSessionDetails,
  formatTimestamp
}) {
  mountNode.innerHTML = '';

  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:16px;">
      <div>
        <h2 style="margin:0 0 6px 0;">📦 Artifacts</h2>
        <p style="margin:0; color:var(--muted);">Inspect outputs produced by workflow runs and trace them back to the run and task that created them.</p>
      </div>
      <button id="artifactsRefreshBtn" class="secondary-btn" type="button">Refresh</button>
    </div>
    <div id="artifactsSummary" style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;"></div>
    <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft);">
      <div style="display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:10px; margin-bottom:12px;">
        <label style="display:grid; gap:6px;">
          <span>Workflow</span>
          <select id="artifactsFilterWorkflow"></select>
        </label>
        <label style="display:grid; gap:6px;">
          <span>Artifact Type</span>
          <select id="artifactsFilterType"></select>
        </label>
        <label style="display:grid; gap:6px;">
          <span>Status</span>
          <select id="artifactsFilterStatus"></select>
        </label>
        <label style="display:grid; gap:6px;">
          <span>Agent</span>
          <select id="artifactsFilterAgent"></select>
        </label>
        <label style="display:grid; gap:6px;">
          <span>Site</span>
          <select id="artifactsFilterSite"></select>
        </label>
      </div>
      <div id="artifactsList">Loading artifacts...</div>
    </section>
  `;
  mountNode.appendChild(container);

  const summaryEl = container.querySelector('#artifactsSummary');
  const listEl = container.querySelector('#artifactsList');
  const refreshBtn = container.querySelector('#artifactsRefreshBtn');
  const workflowFilter = container.querySelector('#artifactsFilterWorkflow');
  const typeFilter = container.querySelector('#artifactsFilterType');
  const statusFilter = container.querySelector('#artifactsFilterStatus');
  const agentFilter = container.querySelector('#artifactsFilterAgent');
  const siteFilter = container.querySelector('#artifactsFilterSite');

  let artifacts = [];

  function renderOptions(select, values, allLabel) {
    const items = [{ value: '', label: allLabel }].concat(
      values
        .filter(Boolean)
        .sort((left, right) => String(left).localeCompare(String(right), undefined, { sensitivity: 'base' }))
        .map((value) => ({ value, label: value }))
    );
    select.innerHTML = items
      .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
      .join('');
  }

  function filteredArtifacts() {
    return artifacts.filter((artifact) => {
      if (workflowFilter.value && artifact.workflowType !== workflowFilter.value) return false;
      if (typeFilter.value && artifact.artifactType !== typeFilter.value) return false;
      if (statusFilter.value && artifact.status !== statusFilter.value) return false;
      if (agentFilter.value && (artifact.createdBy || artifact.ownerAgentId) !== agentFilter.value) return false;
      if (siteFilter.value && (artifact.customerScope || '') !== siteFilter.value) return false;
      return true;
    });
  }

  function renderSummary() {
    const items = filteredArtifacts();
    const generated = items.filter((artifact) => artifact.status === 'generated').length;
    const approved = items.filter((artifact) => artifact.status === 'approved').length;
    const attached = items.filter((artifact) => artifact.status === 'attached').length;

    summaryEl.innerHTML = [
      { label: 'Visible artifacts', value: items.length },
      { label: 'Generated', value: generated },
      { label: 'Attached', value: attached },
      { label: 'Approved', value: approved }
    ].map((card) => `
      <div style="background:var(--bg-2); border-radius:10px; padding:12px 14px; min-width:140px;">
        <div style="font-size:1.6em; font-weight:700;">${card.value}</div>
        <div style="color:var(--muted);">${escapeHtml(card.label)}</div>
      </div>
    `).join('');
  }

  function renderList() {
    const items = filteredArtifacts();
    renderSummary();

    if (!items.length) {
      listEl.innerHTML = '<p style="margin:0; color:var(--muted);">No artifacts match the current filters.</p>';
      return;
    }

    listEl.innerHTML = `
      <div style="overflow:auto;">
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:var(--bg-2);">
              <th style="text-align:left; padding:8px;">Artifact</th>
              <th style="text-align:left; padding:8px;">Workflow</th>
              <th style="text-align:left; padding:8px;">Task</th>
              <th style="text-align:left; padding:8px;">Site</th>
              <th style="text-align:left; padding:8px;">Status</th>
              <th style="text-align:left; padding:8px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((artifact) => `
              <tr style="border-bottom:1px solid var(--border); vertical-align:top;">
                <td style="padding:10px;">
                  <div style="font-weight:700;">${escapeHtml(artifact.label)}</div>
                  <div style="color:var(--muted); font-size:0.92em;">${escapeHtml(artifact.artifactType || 'output')}</div>
                  <div style="font-size:0.9em; margin-top:4px; word-break:break-word;">
                    <a href="${escapeHtml(artifact.uri || '#')}" target="_blank" rel="noreferrer">${escapeHtml(artifact.uri || 'Open')}</a>
                  </div>
                </td>
                <td style="padding:10px;">
                  <div>${escapeHtml(artifact.workflowType || 'Unknown')}</div>
                  <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(artifact.ownerAgentId || artifact.createdBy || 'Unknown')}</div>
                </td>
                <td style="padding:10px;">
                  <div>${escapeHtml(artifact.taskTitle || 'No linked task')}</div>
                  <div style="color:var(--muted); font-size:0.9em;">Run: ${escapeHtml(artifact.workflowRunId || 'Unknown')}</div>
                </td>
                <td style="padding:10px;">${escapeHtml(artifact.customerScope || 'N/A')}</td>
                <td style="padding:10px;">
                  <span style="display:inline-flex; padding:4px 8px; border-radius:999px; background:var(--bg-2);">${escapeHtml((artifact.status || 'generated').replace(/_/g, ' '))}</span>
                  <div style="color:var(--muted); font-size:0.88em; margin-top:6px;">${escapeHtml(formatTimestamp(artifact.createdAt))}</div>
                </td>
                <td style="padding:10px;">
                  <div style="display:flex; flex-wrap:wrap; gap:8px;">
                    <button class="secondary-btn" type="button" data-artifact-run="${escapeHtml(artifact.workflowRunId || '')}">Run</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    listEl.querySelectorAll('[data-artifact-run]').forEach((button) => {
      button.addEventListener('click', () => {
        const runId = button.getAttribute('data-artifact-run');
        if (runId && showSessionDetails) {
          showSessionDetails(runId);
        }
      });
    });
  }

  async function loadArtifacts() {
    const response = await fetchImpl('/api/artifacts?limit=250', { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Artifacts request failed with status ${response.status}`);
    }

    const payload = await response.json();
    artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];

    renderOptions(workflowFilter, [...new Set(artifacts.map((artifact) => artifact.workflowType))], 'All workflows');
    renderOptions(typeFilter, [...new Set(artifacts.map((artifact) => artifact.artifactType))], 'All artifact types');
    renderOptions(statusFilter, [...new Set(artifacts.map((artifact) => artifact.status))], 'All statuses');
    renderOptions(agentFilter, [...new Set(artifacts.map((artifact) => artifact.createdBy || artifact.ownerAgentId))], 'All agents');
    renderOptions(siteFilter, [...new Set(artifacts.map((artifact) => artifact.customerScope))], 'All sites');
    renderList();
  }

  [workflowFilter, typeFilter, statusFilter, agentFilter, siteFilter].forEach((select) => {
    select.addEventListener('change', renderList);
  });

  refreshBtn.addEventListener('click', async () => {
    try {
      await loadArtifacts();
      showNotice('Artifacts refreshed.', 'success');
    } catch (error) {
      console.error('[Artifacts] Refresh failed:', error);
      showNotice('Failed to refresh artifacts.', 'error');
    }
  });

  try {
    await loadArtifacts();
  } catch (error) {
    console.error('[Artifacts] Initial load failed:', error);
    listEl.innerHTML = '<p style="margin:0; color:var(--accent-3);">Failed to load artifacts.</p>';
    summaryEl.innerHTML = '';
    showNotice('Artifacts view unavailable.', 'error');
  }
}

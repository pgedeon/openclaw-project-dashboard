export async function renderMetricsView({
  state,
  mountNode,
  fetchImpl = fetch,
  escapeHtml,
  showNotice
}) {
  mountNode.innerHTML = '';

  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:16px;">
      <div>
        <h2 style="margin:0 0 6px 0;">Metrics Dashboard</h2>
        <p style="margin:0; color:var(--muted);">Measure business outcomes across the org, departments, agents, services, and sites.</p>
      </div>
      <button id="metricsRefreshBtn" class="secondary-btn" type="button">Refresh</button>
    </div>
    <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft); margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:end; gap:16px; flex-wrap:wrap;">
        <div style="display:grid; grid-template-columns:repeat(2, minmax(160px, 220px)); gap:12px;">
          <label style="display:grid; gap:6px;">
            <span>From</span>
            <input id="metricsDateFrom" type="date">
          </label>
          <label style="display:grid; gap:6px;">
            <span>To</span>
            <input id="metricsDateTo" type="date">
          </label>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="secondary-btn" type="button" data-metrics-range="7">Last 7 Days</button>
          <button class="secondary-btn" type="button" data-metrics-range="30">Last 30 Days</button>
          <button class="secondary-btn" type="button" data-metrics-range="90">Last 90 Days</button>
        </div>
      </div>
    </section>
    <div id="metrics-content">Loading...</div>
  `;
  mountNode.appendChild(container);

  const contentDiv = container.querySelector('#metrics-content');
  const refreshBtn = container.querySelector('#metricsRefreshBtn');
  const fromInput = container.querySelector('#metricsDateFrom');
  const toInput = container.querySelector('#metricsDateTo');

  function dateToInputValue(date) {
    return date.toISOString().slice(0, 10);
  }

  function applyPresetRange(days) {
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - ((days - 1) * 24 * 60 * 60 * 1000));
    fromInput.value = dateToInputValue(fromDate);
    toInput.value = dateToInputValue(toDate);
  }

  function formatPercent(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
    return `${Number(value).toFixed(1)}%`;
  }

  function formatHours(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
    return `${Number(value).toFixed(1)}h`;
  }

  function renderMetricCards(cards) {
    return `
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
        ${cards.map((card) => `
          <div style="background:var(--bg-2); border-radius:10px; padding:12px 14px; min-width:150px;">
            <div style="font-size:1.5em; font-weight:700;">${escapeHtml(card.value)}</div>
            <div style="font-size:0.86em; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted);">${escapeHtml(card.label)}</div>
            ${card.detail ? `<div style="margin-top:4px; color:var(--muted); font-size:0.9em;">${escapeHtml(card.detail)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderTable(title, description, columns, rows, emptyMessage) {
    return `
      <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft); margin-bottom:16px;">
        <div style="margin-bottom:12px;">
          <h3 style="margin:0 0 6px 0;">${escapeHtml(title)}</h3>
          <p style="margin:0; color:var(--muted);">${escapeHtml(description)}</p>
        </div>
        ${rows.length ? `
          <div style="overflow:auto;">
            <table style="width:100%; border-collapse:collapse;">
              <thead>
                <tr style="background:var(--bg-2);">
                  ${columns.map((column) => `<th style="text-align:left; padding:8px;">${escapeHtml(column.label)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr style="border-bottom:1px solid var(--border); vertical-align:top;">
                    ${columns.map((column) => `<td style="padding:10px;">${column.render(row)}</td>`).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p style="margin:0; color:var(--muted);">${escapeHtml(emptyMessage)}</p>`}
      </section>
    `;
  }

  function renderDepartmentTrendSection(departments, departmentDetail) {
    const selectedDepartmentId = departmentDetail?.department?.id || state.metricsSelectedDepartmentId || '';
    const trendRows = Array.isArray(departmentDetail?.trend) ? departmentDetail.trend : [];

    return `
      <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft); margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:end; gap:16px; flex-wrap:wrap; margin-bottom:12px;">
          <div>
            <h3 style="margin:0 0 6px 0;">Department Trend Snapshots</h3>
            <p style="margin:0; color:var(--muted);">Daily snapshot history from <code>department_daily_metrics</code> for the selected department.</p>
          </div>
          <label style="display:grid; gap:6px; min-width:220px;">
            <span>Department</span>
            <select id="metricsDepartmentSelect" ${departments.length ? '' : 'disabled'}>
              ${departments.map((department) => {
                const value = department.departmentId || department.departmentSlug || '';
                return `
                  <option value="${escapeHtml(value)}" ${value === selectedDepartmentId ? 'selected' : ''}>
                    ${escapeHtml(department.departmentName || value)}
                  </option>
                `;
              }).join('')}
            </select>
          </label>
        </div>
        ${departmentDetail?.department ? `
          <div style="margin-bottom:12px; color:var(--muted);">
            Showing ${escapeHtml(departmentDetail.department.name || departmentDetail.department.id)} snapshots for the active date range.
          </div>
        ` : ''}
        ${trendRows.length ? `
          <div style="overflow:auto;">
            <table style="width:100%; border-collapse:collapse;">
              <thead>
                <tr style="background:var(--bg-2);">
                  <th style="text-align:left; padding:8px;">Date</th>
                  <th style="text-align:left; padding:8px;">Requests</th>
                  <th style="text-align:left; padding:8px;">Runs</th>
                  <th style="text-align:left; padding:8px;">Success Rate</th>
                  <th style="text-align:left; padding:8px;">Blocked Time</th>
                  <th style="text-align:left; padding:8px;">Approval Latency</th>
                  <th style="text-align:left; padding:8px;">Median Completion</th>
                </tr>
              </thead>
              <tbody>
                ${trendRows.map((row) => `
                  <tr style="border-bottom:1px solid var(--border); vertical-align:top;">
                    <td style="padding:10px; font-weight:700;">${escapeHtml(row.metricDate || 'unknown')}</td>
                    <td style="padding:10px;">${escapeHtml(row.serviceRequestsOpened || 0)} opened<br><span style="color:var(--muted);">${escapeHtml(row.serviceRequestsCompleted || 0)} completed</span></td>
                    <td style="padding:10px;">${escapeHtml(row.workflowRunsStarted || 0)} started<br><span style="color:var(--muted);">${escapeHtml(row.workflowRunsCompleted || 0)} completed / ${escapeHtml(row.workflowRunsFailed || 0)} failed</span></td>
                    <td style="padding:10px;">${escapeHtml(formatPercent(row.workflowSuccessRate))}</td>
                    <td style="padding:10px;">${escapeHtml(formatHours(row.blockedTimeHours))}</td>
                    <td style="padding:10px;">${escapeHtml(formatHours(row.approvalLatencyHours))}</td>
                    <td style="padding:10px;">${escapeHtml(formatHours(row.medianCompletionHours))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p style="margin:0; color:var(--muted);">No daily department snapshots are available yet for this range. Run the metrics aggregation job to populate trend history.</p>'}
      </section>
    `;
  }

  async function loadMetrics() {
    const from = fromInput.value || dateToInputValue(new Date(Date.now() - (29 * 24 * 60 * 60 * 1000)));
    const to = toInput.value || dateToInputValue(new Date());
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const [orgRes, departmentsRes, agentsRes, servicesRes, sitesRes] = await Promise.all([
      fetchImpl(`/api/metrics/org?${query}`, { headers: { Accept: 'application/json' } }),
      fetchImpl(`/api/metrics/departments?${query}`, { headers: { Accept: 'application/json' } }),
      fetchImpl(`/api/metrics/agents?${query}`, { headers: { Accept: 'application/json' } }),
      fetchImpl(`/api/metrics/services?${query}`, { headers: { Accept: 'application/json' } }),
      fetchImpl(`/api/metrics/sites?${query}`, { headers: { Accept: 'application/json' } })
    ]);

    if (!orgRes.ok || !departmentsRes.ok || !agentsRes.ok || !servicesRes.ok || !sitesRes.ok) {
      throw new Error('One or more metrics endpoints failed');
    }

    const [orgData, departmentsData, agentsData, servicesData, sitesData] = await Promise.all([
      orgRes.json(),
      departmentsRes.json(),
      agentsRes.json(),
      servicesRes.json(),
      sitesRes.json()
    ]);

    const scorecard = orgData.scorecard || {};
    const departments = Array.isArray(departmentsData.departments) ? departmentsData.departments : [];
    const agents = Array.isArray(agentsData.agents) ? agentsData.agents : [];
    const services = Array.isArray(servicesData.services) ? servicesData.services : [];
    const sites = Array.isArray(sitesData.sites) ? sitesData.sites : [];
    const departmentIds = departments
      .map((department) => department.departmentId || department.departmentSlug || null)
      .filter(Boolean);
    const selectedDepartmentId = departmentIds.includes(state.metricsSelectedDepartmentId)
      ? state.metricsSelectedDepartmentId
      : (departmentIds[0] || null);
    let departmentDetail = null;

    state.metricsSelectedDepartmentId = selectedDepartmentId;

    if (selectedDepartmentId) {
      const detailRes = await fetchImpl(`/api/metrics/departments/${encodeURIComponent(selectedDepartmentId)}?${query}`, {
        headers: { Accept: 'application/json' }
      });
      if (detailRes.ok) {
        departmentDetail = await detailRes.json();
      } else {
        console.warn('[Metrics] Department detail endpoint failed:', detailRes.status);
      }
    }

    let html = `
      <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft); margin-bottom:16px;">
        <div style="margin-bottom:12px;">
          <h3 style="margin:0 0 6px 0;">Org Scorecard</h3>
          <p style="margin:0; color:var(--muted);">Outcome metrics for the selected date range across the whole business operating layer.</p>
        </div>
        ${renderMetricCards([
          { label: 'Service Requests Opened', value: scorecard.serviceRequestsOpened || 0, detail: `${scorecard.serviceRequestsCompleted || 0} completed` },
          { label: 'Workflow Runs Started', value: scorecard.workflowRunsStarted || 0, detail: `${scorecard.workflowRunsCompleted || 0} completed ${String.fromCharCode(183)} ${scorecard.workflowRunsFailed || 0} failed` },
          { label: 'Workflow Success Rate', value: formatPercent(scorecard.workflowSuccessRate), detail: `Median completion ${formatHours(scorecard.medianCompletionHours)}` },
          { label: 'Blocked Time', value: formatHours(scorecard.blockedTimeHours), detail: `${scorecard.staleRunCount || 0} stale runs` },
          { label: 'Approval Latency', value: formatHours(scorecard.approvalLatencyHours), detail: `${scorecard.pendingApprovals || 0} pending approvals` },
          { label: 'Coverage', value: `${scorecard.departmentsTracked || 0}/${scorecard.agentsTracked || 0}/${scorecard.sitesTracked || 0}`, detail: 'Departments / Agents / Sites' }
        ])}
      </section>
    `;

    html += renderTable(
      'Department Scorecards',
      'Department metrics: service intake, workflow throughput, success rate, blocked time, approval latency, and median completion time.',
      [
        { label: 'Department', render: (row) => `<div style="font-weight:700;">${escapeHtml(row.departmentName || row.departmentId)}</div><div style="color:var(--muted); font-size:0.9em;">${escapeHtml(row.departmentSlug || 'unassigned')}</div>` },
        { label: 'Requests', render: (row) => `${escapeHtml(row.serviceRequestsOpened || 0)} opened<br><span style="color:var(--muted);">${escapeHtml(row.serviceRequestsCompleted || 0)} completed</span>` },
        { label: 'Runs', render: (row) => `${escapeHtml(row.workflowRunsStarted || 0)} started<br><span style="color:var(--muted);">${escapeHtml(row.workflowRunsCompleted || 0)} completed / ${escapeHtml(row.workflowRunsFailed || 0)} failed</span>` },
        { label: 'Success Rate', render: (row) => escapeHtml(formatPercent(row.workflowSuccessRate)) },
        { label: 'Blocked Time', render: (row) => escapeHtml(formatHours(row.blockedTimeHours)) },
        { label: 'Approval Latency', render: (row) => escapeHtml(formatHours(row.approvalLatencyHours)) },
        { label: 'Median Completion', render: (row) => escapeHtml(formatHours(row.medianCompletionHours)) }
      ],
      departments,
      'No department metrics are available for this date range.'
    );

    html += renderDepartmentTrendSection(departments, departmentDetail);

    html += renderTable(
      'Agent Scorecards',
      'Agent metrics: active workload, completions, failures, retries, stale runs, and approval burden.',
      [
        { label: 'Agent', render: (row) => `<div style="font-weight:700;">${escapeHtml(row.displayName || row.agentId)}</div><div style="color:var(--muted); font-size:0.9em;">${escapeHtml(row.agentId || 'unknown')}</div>` },
        { label: 'Department', render: (row) => escapeHtml(row.department?.name || 'Unassigned') },
        { label: 'Active Workload', render: (row) => escapeHtml(row.activeWorkload || 0) },
        { label: 'Completions', render: (row) => escapeHtml(row.completionCount || 0) },
        { label: 'Failures', render: (row) => escapeHtml(row.failureCount || 0) },
        { label: 'Retries', render: (row) => escapeHtml(row.retryCount || 0) },
        { label: 'Stale Runs', render: (row) => escapeHtml(row.staleRunCount || 0) },
        { label: 'Approval Burden', render: (row) => escapeHtml(row.approvalBurden || 0) }
      ],
      agents,
      'No agent metrics are available for this date range.'
    );

    html += renderTable(
      'Site Scorecards',
      'Site metrics for customer scopes like 3dput and sailboats-fr: drafts, publishing, image QA, and verification quality.',
      [
        { label: 'Site', render: (row) => `<div style="font-weight:700;">${escapeHtml(row.siteKey || 'unknown')}</div><div style="color:var(--muted); font-size:0.9em;">${escapeHtml(row.totalRuns || 0)} runs</div>` },
        { label: 'Drafts', render: (row) => `${escapeHtml(row.draftsCreated || 0)} created<br><span style="color:var(--muted);">${escapeHtml(row.draftsApproved || 0)} approved</span>` },
        { label: 'Posts Published', render: (row) => escapeHtml(row.postsPublished || 0) },
        { label: 'Image Pass Rate', render: (row) => escapeHtml(formatPercent(row.imagePassRate)) },
        { label: 'Verification Pass Rate', render: (row) => escapeHtml(formatPercent(row.publishVerificationPassRate)) },
        { label: 'Publish Defect Rate', render: (row) => escapeHtml(formatPercent(row.publishDefectRate)) }
      ],
      sites,
      'No site metrics are available for this date range.'
    );

    html += renderTable(
      'Service Scorecards',
      'Service-level metrics for intake and workflow throughput by service line.',
      [
        { label: 'Service', render: (row) => `<div style="font-weight:700;">${escapeHtml(row.serviceName || row.serviceId)}</div><div style="color:var(--muted); font-size:0.9em;">${escapeHtml(row.department?.name || 'Unassigned')}</div>` },
        { label: 'Requests', render: (row) => `${escapeHtml(row.requestsOpened || 0)} opened<br><span style="color:var(--muted);">${escapeHtml(row.requestsCompleted || 0)} completed</span>` },
        { label: 'Runs', render: (row) => `${escapeHtml(row.workflowRunsStarted || 0)} started<br><span style="color:var(--muted);">${escapeHtml(row.workflowRunsCompleted || 0)} completed / ${escapeHtml(row.workflowRunsFailed || 0)} failed</span>` },
        { label: 'Success Rate', render: (row) => escapeHtml(formatPercent(row.workflowSuccessRate)) },
        { label: 'Median Completion', render: (row) => escapeHtml(formatHours(row.medianCompletionHours)) }
      ],
      services,
      'No service metrics are available for this date range.'
    );

    contentDiv.innerHTML = html;

    const departmentSelect = contentDiv.querySelector('#metricsDepartmentSelect');
    if (departmentSelect) {
      departmentSelect.addEventListener('change', async () => {
        state.metricsSelectedDepartmentId = departmentSelect.value || null;
        try {
          await loadMetrics();
        } catch (error) {
          console.error('[Metrics] Department trend reload failed:', error);
          showNotice('Failed to reload department trend snapshots.', 'error');
        }
      });
    }
  }

  try {
    applyPresetRange(30);
    await loadMetrics();
  } catch (error) {
    console.error('[Metrics]', error);
    contentDiv.innerHTML = '<p style="color:var(--accent-3);">Error loading metrics.</p>';
  }

  [fromInput, toInput].forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await loadMetrics();
      } catch (error) {
        console.error('[Metrics] Range reload failed:', error);
        showNotice('Failed to reload metrics for that date range.', 'error');
      }
    });
  });

  container.querySelectorAll('[data-metrics-range]').forEach((button) => {
    button.addEventListener('click', async () => {
      const days = Number.parseInt(button.getAttribute('data-metrics-range') || '30', 10);
      applyPresetRange(days);
      try {
        await loadMetrics();
      } catch (error) {
        console.error('[Metrics] Preset reload failed:', error);
        showNotice('Failed to reload metrics for that preset range.', 'error');
      }
    });
  });

  refreshBtn.addEventListener('click', async () => {
    try {
      await loadMetrics();
      showNotice('Metrics refreshed.', 'success');
    } catch (error) {
      console.error('[Metrics] Refresh failed:', error);
      showNotice('Failed to refresh metrics.', 'error');
    }
  });
}

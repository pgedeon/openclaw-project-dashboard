export async function renderDepartmentsView({
  state,
  mountNode,
  fetchImpl = fetch,
  escapeHtml,
  showNotice,
  showSessionDetails,
  renderViewSwitch,
  getStateSync,
  formatTimestamp
}) {
  mountNode.innerHTML = '';

  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:16px;">
      <div>
        <h2 style="margin:0 0 6px 0;">🏢 Departments</h2>
        <p style="margin:0; color:var(--muted);">Run each department like a business unit: staffing, queue health, approvals, artifacts, and reliability in one place.</p>
      </div>
      <button id="departmentOpsRefreshBtn" class="secondary-btn" type="button">Refresh</button>
    </div>
    <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft); margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:end; gap:16px; flex-wrap:wrap;">
        <label style="display:grid; gap:6px; min-width:260px;">
          <span>Department</span>
          <select id="departmentOpsSelect"></select>
        </label>
        <div id="departmentOpsSummary" style="display:flex; gap:12px; flex-wrap:wrap; justify-content:flex-end;"></div>
      </div>
    </section>
    <div id="departmentOpsBody">Loading department operations...</div>
  `;
  mountNode.appendChild(container);

  const selectEl = container.querySelector('#departmentOpsSelect');
  const summaryEl = container.querySelector('#departmentOpsSummary');
  const bodyEl = container.querySelector('#departmentOpsBody');
  const refreshBtn = container.querySelector('#departmentOpsRefreshBtn');

  let departments = [];
  let selectedDepartmentId = '';
  let departmentView = null;

  function humanize(value, fallback = 'N/A') {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value).replace(/_/g, ' ');
  }

  function formatPercent(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
    return `${Number(value).toFixed(1)}%`;
  }

  function formatHours(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
    return `${Number(value).toFixed(1)}h`;
  }

  function renderOptions() {
    selectEl.innerHTML = departments
      .map((department) => `<option value="${escapeHtml(department.id || department.slug)}">${escapeHtml(department.name || department.slug || 'Department')}</option>`)
      .join('');
    selectEl.value = selectedDepartmentId;
  }

  function renderSummaryCards(view) {
    if (!view) {
      summaryEl.innerHTML = '';
      return;
    }

    const staffedAgents = Array.isArray(view.overview?.staffedAgents) ? view.overview.staffedAgents : [];
    const serviceLines = Array.isArray(view.overview?.serviceLines) ? view.overview.serviceLines : [];
    const workingAgents = staffedAgents.filter((agent) => ['working', 'queued'].includes(agent.presence)).length;
    const cards = [
      {
        label: 'Lead',
        value: view.overview?.lead?.name || 'Unassigned',
        detail: view.overview?.lead?.role || 'No lead configured'
      },
      {
        label: 'Staffed Agents',
        value: staffedAgents.length,
        detail: `${workingAgents} active now`
      },
      {
        label: 'Service Lines',
        value: serviceLines.length,
        detail: `${serviceLines.reduce((sum, item) => sum + Number(item.activeRequestCount || 0), 0)} open requests`
      },
      {
        label: 'Blocked Work',
        value: view.workQueue?.blockedWork?.length || 0,
        detail: `${view.blockerSummary?.escalated || 0} escalated`
      },
      {
        label: 'Success Rate',
        value: formatPercent(view.reliability?.successRate),
        detail: `Retry ${formatPercent(view.reliability?.retryRate)}`
      }
    ];

    summaryEl.innerHTML = cards.map((card) => `
      <div style="background:var(--bg-2); border-radius:10px; padding:12px 14px; min-width:150px;">
        <div style="font-size:1.35em; font-weight:700;">${escapeHtml(card.value)}</div>
        <div style="font-size:0.86em; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted);">${escapeHtml(card.label)}</div>
        <div style="margin-top:4px; color:var(--muted); font-size:0.9em;">${escapeHtml(card.detail)}</div>
      </div>
    `).join('');
  }

  function renderAgentRoster(agents) {
    if (!agents.length) {
      return '<p style="margin:0; color:var(--muted);">No staffed agents are assigned to this department yet.</p>';
    }

    return `
      <div style="display:grid; gap:10px;">
        ${agents.map((agent) => `
          <div style="border:1px solid var(--border); border-radius:10px; padding:10px; background:var(--surface);">
            <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
              <div>
                <div style="font-weight:700;">${escapeHtml(agent.name || agent.agentId || 'Agent')}</div>
                <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(agent.role || 'No role')} · ${escapeHtml(humanize(agent.presence, 'offline'))}</div>
              </div>
              <div style="display:flex; gap:10px; flex-wrap:wrap; color:var(--muted); font-size:0.88em;">
                <span>Ready ${escapeHtml(agent.readyTasks || 0)}</span>
                <span>Active ${escapeHtml(agent.activeTasks || 0)}</span>
                <span>Blocked ${escapeHtml(agent.blockedTasks || 0)}</span>
                <span>Overdue ${escapeHtml(agent.overdueTasks || 0)}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderServiceLines(lines) {
    if (!lines.length) {
      return '<p style="margin:0; color:var(--muted);">No service lines are configured for this department yet.</p>';
    }

    return `
      <div style="overflow:auto;">
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:var(--bg-2);">
              <th style="text-align:left; padding:8px;">Service Line</th>
              <th style="text-align:left; padding:8px;">Template</th>
              <th style="text-align:left; padding:8px;">Default Owner</th>
              <th style="text-align:left; padding:8px;">Load</th>
            </tr>
          </thead>
          <tbody>
            ${lines.map((line) => `
              <tr style="border-bottom:1px solid var(--border); vertical-align:top;">
                <td style="padding:10px;">
                  <div style="font-weight:700;">${escapeHtml(line.name || line.slug || 'Service line')}</div>
                  <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(line.description || 'No description')}</div>
                </td>
                <td style="padding:10px;">${escapeHtml(line.workflowTemplateName || 'Not linked')}</td>
                <td style="padding:10px;">${escapeHtml(line.defaultAgentId || 'Unassigned')}</td>
                <td style="padding:10px;">
                  <div>${escapeHtml(line.activeRequestCount || 0)} requests</div>
                  <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(line.runningRunCount || 0)} active runs · SLA ${escapeHtml(line.slaHours || 72)}h</div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderCardList(title, items, renderItem, emptyMessage) {
    return `
      <div style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; display:grid; gap:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
          <h4 style="margin:0;">${escapeHtml(title)}</h4>
          <span style="color:var(--muted); font-size:0.9em;">${escapeHtml(items.length)}</span>
        </div>
        ${items.length ? `<div style="display:grid; gap:10px;">${items.map(renderItem).join('')}</div>` : `<p style="margin:0; color:var(--muted);">${escapeHtml(emptyMessage)}</p>`}
      </div>
    `;
  }

  function renderDepartmentView() {
    if (!departmentView) {
      bodyEl.innerHTML = '<p style="margin:0; color:var(--muted);">Select a department to inspect operating data.</p>';
      renderSummaryCards(null);
      return;
    }

    const view = departmentView;
    const overview = view.overview || {};
    const workQueue = view.workQueue || {};
    const approvals = view.approvals || {};
    const artifacts = view.artifacts || {};
    const reliability = view.reliability || {};
    const blockerSummary = view.blockerSummary || {};

    renderSummaryCards(view);

    bodyEl.innerHTML = `
      <div style="display:grid; gap:16px;">
        <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:14px;">
            <div>
              <h3 style="margin:0 0 6px 0;">Overview</h3>
              <p style="margin:0; color:var(--muted);">Lead, staffed agents, service lines, and current workload for ${escapeHtml(view.department?.name || 'this department')}.</p>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:minmax(280px, 360px) minmax(0, 1fr); gap:16px; align-items:start;">
            <div style="display:grid; gap:12px;">
              <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:12px; padding:14px;">
                <div style="font-size:0.82em; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:4px;">Lead</div>
                <div style="font-size:1.1em; font-weight:700;">${escapeHtml(overview.lead?.name || 'Unassigned')}</div>
                <div style="color:var(--muted); font-size:0.92em; margin-top:4px;">${escapeHtml(overview.lead?.role || 'No lead role configured')} · ${escapeHtml(humanize(overview.lead?.presence, 'offline'))}</div>
              </div>
              <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:12px; padding:14px;">
                <h4 style="margin:0 0 10px 0;">Staffed Agents</h4>
                ${renderAgentRoster(Array.isArray(overview.staffedAgents) ? overview.staffedAgents : [])}
              </div>
            </div>
            <div style="display:grid; gap:12px;">
              <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:12px; padding:14px;">
                <h4 style="margin:0 0 10px 0;">Current Workload</h4>
                <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px;">
                  ${[
                    { label: 'Open Requests', value: overview.currentWorkload?.openServiceRequests || 0 },
                    { label: 'Active Runs', value: overview.currentWorkload?.activeRuns || 0 },
                    { label: 'Blocked Work', value: overview.currentWorkload?.blockedWork || 0 },
                    { label: 'Overdue Items', value: overview.currentWorkload?.overdueItems || 0 }
                  ].map((item) => `
                    <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:12px;">
                      <div style="font-size:1.4em; font-weight:700;">${escapeHtml(item.value)}</div>
                      <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.label)}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
              <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:12px; padding:14px;">
                <h4 style="margin:0 0 10px 0;">Service Lines</h4>
                ${renderServiceLines(Array.isArray(overview.serviceLines) ? overview.serviceLines : [])}
              </div>
            </div>
          </div>
        </section>

        <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:14px;">
            <div>
              <h3 style="margin:0 0 6px 0;">Work Queue</h3>
              <p style="margin:0; color:var(--muted);">Open service requests, active runs, blocked work, and overdue items for department leads.</p>
            </div>
            <button class="secondary-btn" type="button" data-department-switch-view="service-requests">Open Service Requests</button>
          </div>
          <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px;">
            ${renderCardList(
              'Open Service Requests',
              Array.isArray(workQueue.openServiceRequests) ? workQueue.openServiceRequests : [],
              (item) => `
                <div style="border:1px solid var(--border); border-radius:10px; padding:10px; background:var(--bg-2);">
                  <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
                    <div>
                      <div style="font-weight:700;">${escapeHtml(item.title || item.id)}</div>
                      <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.serviceName || 'Unknown service')} · ${escapeHtml(humanize(item.status, 'new'))}</div>
                      <div style="color:var(--muted); font-size:0.88em; margin-top:4px;">Priority ${escapeHtml(item.priority || 'medium')} · ${escapeHtml(item.requestedBy || 'unknown')} · ${escapeHtml(formatTimestamp(item.updatedAt))}</div>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                      ${item.workflowRunId ? `<button class="secondary-btn" type="button" data-department-open-run="${escapeHtml(item.workflowRunId)}">Run</button>` : ''}
                      <button class="secondary-btn" type="button" data-department-switch-view="service-requests">Queue</button>
                    </div>
                  </div>
                </div>
              `,
              'No open service requests for this department.'
            )}
            ${renderCardList(
              'Active Runs',
              Array.isArray(workQueue.activeRuns) ? workQueue.activeRuns : [],
              (item) => `
                <div style="border:1px solid var(--border); border-radius:10px; padding:10px; background:var(--bg-2);">
                  <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
                    <div>
                      <div style="font-weight:700;">${escapeHtml(item.taskTitle || item.serviceRequestTitle || item.workflowType || item.id)}</div>
                      <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.workflowType || 'workflow')} · ${escapeHtml(humanize(item.status, 'running'))}</div>
                      <div style="color:var(--muted); font-size:0.88em; margin-top:4px;">Step ${escapeHtml(item.currentStep || 'not started')} · Owner ${escapeHtml(item.ownerAgentId || 'unassigned')} · ${escapeHtml(formatTimestamp(item.updatedAt))}</div>
                    </div>
                    <button class="secondary-btn" type="button" data-department-open-run="${escapeHtml(item.id)}">Open Run</button>
                  </div>
                </div>
              `,
              'No active workflow runs are assigned to this department.'
            )}
            ${renderCardList(
              'Blocked Work',
              Array.isArray(workQueue.blockedWork) ? workQueue.blockedWork : [],
              (item) => `
                <div style="border:1px solid var(--border); border-radius:10px; padding:10px; background:var(--bg-2);">
                  <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
                    <div>
                      <div style="font-weight:700;">${escapeHtml(item.title || item.entityId || 'Blocked work')}</div>
                      <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.blockerLabel || humanize(item.blockerType, 'blocked'))} · ${escapeHtml(item.entityType || 'item')}</div>
                      <div style="color:var(--muted); font-size:0.88em; margin-top:4px;">${escapeHtml(item.blockerDescription || item.nextAction || 'Needs attention')}</div>
                      <div style="color:var(--muted); font-size:0.85em; margin-top:4px;">${escapeHtml(formatTimestamp(item.detectedAt))}${item.escalatedTo ? ` · Escalated to ${escapeHtml(item.escalatedTo)}` : ''}</div>
                    </div>
                    ${item.workflowRunId ? `<button class="secondary-btn" type="button" data-department-open-run="${escapeHtml(item.workflowRunId)}">Open Run</button>` : '<span style="color:var(--muted); font-size:0.88em;">Task blocker</span>'}
                  </div>
                </div>
              `,
              'No blocked work is currently detected.'
            )}
            ${renderCardList(
              'Overdue Items',
              Array.isArray(workQueue.overdueItems) ? workQueue.overdueItems : [],
              (item) => `
                <div style="border:1px solid var(--border); border-radius:10px; padding:10px; background:var(--bg-2);">
                  <div style="font-weight:700;">${escapeHtml(item.title || item.id)}</div>
                  <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.projectName || 'No board')} · ${escapeHtml(humanize(item.status, 'pending'))}</div>
                  <div style="color:var(--muted); font-size:0.88em; margin-top:4px;">Due ${escapeHtml(formatTimestamp(item.dueDate))} · Owner ${escapeHtml(item.ownerAgentId || 'unassigned')} · Priority ${escapeHtml(item.priority || 'medium')}</div>
                </div>
              `,
              'No overdue items are linked to this department.'
            )}
          </div>
        </section>

        <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:14px;">
            <div>
              <h3 style="margin:0 0 6px 0;">Approvals</h3>
              <p style="margin:0; color:var(--muted);">Pending approvals, expired approvals, and approval latency for this department.</p>
            </div>
            <button class="secondary-btn" type="button" data-department-switch-view="approvals">Open Approvals</button>
          </div>
          <div style="display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; margin-bottom:12px;">
            ${[
              { label: 'Pending', value: approvals.pending || 0 },
              { label: 'Expired', value: approvals.expired || 0 },
              { label: 'Average Approval Time', value: formatHours(approvals.averageDecisionHours) }
            ].map((item) => `
              <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:10px; padding:12px;">
                <div style="font-size:1.4em; font-weight:700;">${escapeHtml(item.value)}</div>
                <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.label)}</div>
              </div>
            `).join('')}
          </div>
          ${renderCardList(
            'Pending Approval Items',
            Array.isArray(approvals.items) ? approvals.items : [],
            (item) => `
              <div style="border:1px solid var(--border); border-radius:10px; padding:10px; background:var(--bg-2);">
                <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
                  <div>
                    <div style="font-weight:700;">${escapeHtml(item.stepName || humanize(item.approvalType, 'Approval'))}</div>
                    <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.workflowType || 'workflow')} · Approver ${escapeHtml(item.approverId || 'unassigned')}</div>
                    <div style="color:var(--muted); font-size:0.88em; margin-top:4px;">Task ${escapeHtml(item.taskTitle || 'No linked task')} · Due ${escapeHtml(item.dueAt ? formatTimestamp(item.dueAt) : 'No due date')}</div>
                  </div>
                  ${item.workflowRunId ? `<button class="secondary-btn" type="button" data-department-open-run="${escapeHtml(item.workflowRunId)}">Open Run</button>` : ''}
                </div>
              </div>
            `,
            'No pending approvals for this department.'
          )}
        </section>

        <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:14px;">
            <div>
              <h3 style="margin:0 0 6px 0;">Artifacts</h3>
              <p style="margin:0; color:var(--muted);">Recent outputs, failed outputs, and verification reports produced by this department.</p>
            </div>
            <button class="secondary-btn" type="button" data-department-switch-view="artifacts">Open Artifacts</button>
          </div>
          <div style="display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px;">
            ${[
              {
                title: 'Recent Outputs',
                items: Array.isArray(artifacts.recentOutputs) ? artifacts.recentOutputs : [],
                emptyMessage: 'No recent outputs recorded.'
              },
              {
                title: 'Failed Outputs',
                items: Array.isArray(artifacts.failedOutputs) ? artifacts.failedOutputs : [],
                emptyMessage: 'No failed outputs recorded.'
              },
              {
                title: 'Verification Reports',
                items: Array.isArray(artifacts.verificationReports) ? artifacts.verificationReports : [],
                emptyMessage: 'No verification reports recorded.'
              }
            ].map((group) => renderCardList(
              group.title,
              group.items,
              (item) => `
                <div style="border:1px solid var(--border); border-radius:10px; padding:10px; background:var(--bg-2);">
                  <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
                    <div>
                      <div style="font-weight:700;">${escapeHtml(item.label || item.id)}</div>
                      <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.artifactType || 'artifact')} · ${escapeHtml(humanize(item.status, 'generated'))}</div>
                      <div style="color:var(--muted); font-size:0.88em; margin-top:4px;">${escapeHtml(item.taskTitle || item.workflowType || 'No linked task')} · ${escapeHtml(formatTimestamp(item.createdAt))}</div>
                      ${item.uri ? `<div style="font-size:0.88em; margin-top:6px; word-break:break-word;"><a href="${escapeHtml(item.uri)}" target="_blank" rel="noreferrer">${escapeHtml(item.uri)}</a></div>` : ''}
                    </div>
                    ${item.workflowRunId ? `<button class="secondary-btn" type="button" data-department-open-run="${escapeHtml(item.workflowRunId)}">Run</button>` : ''}
                  </div>
                </div>
              `,
              group.emptyMessage
            )).join('')}
          </div>
        </section>

        <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:14px;">
            <div>
              <h3 style="margin:0 0 6px 0;">Reliability</h3>
              <p style="margin:0; color:var(--muted);">Success rate, retry rate, stale runs, and common failure reasons for this department.</p>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin-bottom:12px;">
            ${[
              { label: 'Success Rate', value: formatPercent(reliability.successRate) },
              { label: 'Retry Rate', value: formatPercent(reliability.retryRate) },
              { label: 'Stale Run Count', value: reliability.staleRunCount || 0 },
              { label: 'Failed Runs', value: reliability.failedRuns || 0 }
            ].map((item) => `
              <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:10px; padding:12px;">
                <div style="font-size:1.4em; font-weight:700;">${escapeHtml(item.value)}</div>
                <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.label)}</div>
              </div>
            `).join('')}
          </div>
          <div style="display:grid; grid-template-columns:minmax(0, 1fr) minmax(260px, 340px); gap:12px; align-items:start;">
            <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:12px; padding:14px;">
              <h4 style="margin:0 0 10px 0;">Failure Reasons</h4>
              ${Array.isArray(reliability.failureReasons) && reliability.failureReasons.length ? `
                <div style="overflow:auto;">
                  <table style="width:100%; border-collapse:collapse;">
                    <thead>
                      <tr style="background:var(--surface);">
                        <th style="text-align:left; padding:8px;">Reason</th>
                        <th style="text-align:left; padding:8px;">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${reliability.failureReasons.map((reason) => `
                        <tr style="border-bottom:1px solid var(--border);">
                          <td style="padding:8px;">${escapeHtml(humanize(reason.reason, 'unknown'))}</td>
                          <td style="padding:8px;">${escapeHtml(reason.count || 0)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              ` : '<p style="margin:0; color:var(--muted);">No failure reasons recorded for this department.</p>'}
            </div>
            <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:12px; padding:14px;">
              <h4 style="margin:0 0 10px 0;">Reliability Snapshot</h4>
              <div style="display:grid; gap:8px; color:var(--muted);">
                <div>Total runs: <strong style="color:var(--text);">${escapeHtml(reliability.totalRuns || 0)}</strong></div>
                <div>Completed runs: <strong style="color:var(--text);">${escapeHtml(reliability.completedRuns || 0)}</strong></div>
                <div>Failed runs: <strong style="color:var(--text);">${escapeHtml(reliability.failedRuns || 0)}</strong></div>
                <div>Blocked work detected: <strong style="color:var(--text);">${escapeHtml(blockerSummary.total || 0)}</strong></div>
                <div>Escalated blockers: <strong style="color:var(--text);">${escapeHtml(blockerSummary.escalated || 0)}</strong></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    `;

    bodyEl.querySelectorAll('[data-department-open-run]').forEach((button) => {
      button.addEventListener('click', () => {
        const runId = button.getAttribute('data-department-open-run');
        if (runId && showSessionDetails) {
          showSessionDetails(runId);
        }
      });
    });

    bodyEl.querySelectorAll('[data-department-switch-view]').forEach((button) => {
      button.addEventListener('click', async () => {
        const targetView = button.getAttribute('data-department-switch-view');
        if (targetView && renderViewSwitch && getStateSync) {
          await renderViewSwitch(targetView, getStateSync());
        }
      });
    });
  }

  async function loadDepartmentView() {
    if (!selectedDepartmentId) {
      departmentView = null;
      renderDepartmentView();
      return;
    }

    const response = await fetchImpl(`/api/org/departments/${encodeURIComponent(selectedDepartmentId)}/operating-view`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`Department view request failed with status ${response.status}`);
    }
    departmentView = await response.json();
    renderDepartmentView();
  }

  async function reloadData() {
    bodyEl.innerHTML = '<p style="margin:0; color:var(--muted);">Loading department operations...</p>';

    const departmentsRes = await fetchImpl('/api/org/departments', { headers: { Accept: 'application/json' } });
    if (!departmentsRes.ok) {
      throw new Error(`Departments request failed with status ${departmentsRes.status}`);
    }

    const departmentsData = await departmentsRes.json();
    departments = Array.isArray(departmentsData) ? departmentsData : [];

    if (!departments.length) {
      selectedDepartmentId = '';
      departmentView = null;
      selectEl.innerHTML = '';
      renderDepartmentView();
      bodyEl.innerHTML = '<p style="margin:0; color:var(--muted);">No departments are available yet.</p>';
      return;
    }

    if (!selectedDepartmentId || !departments.some((department) => department.id === selectedDepartmentId || department.slug === selectedDepartmentId)) {
      selectedDepartmentId = departments[0].id || departments[0].slug;
    }

    renderOptions();
    await loadDepartmentView();
  }

  selectEl.addEventListener('change', async () => {
    selectedDepartmentId = selectEl.value;
    try {
      await loadDepartmentView();
    } catch (error) {
      console.error('[Departments] Department switch failed:', error);
      bodyEl.innerHTML = '<p style="margin:0; color:var(--accent-3);">Failed to load department operating view.</p>';
      showNotice('Failed to load department operating view.', 'error');
    }
  });

  refreshBtn.addEventListener('click', async () => {
    try {
      await reloadData();
      showNotice('Department operations refreshed.', 'success');
    } catch (error) {
      console.error('[Departments] Refresh failed:', error);
      showNotice('Failed to refresh department operations.', 'error');
    }
  });

  try {
    await reloadData();
  } catch (error) {
    console.error('[Departments] Initial load failed:', error);
    summaryEl.innerHTML = '';
    bodyEl.innerHTML = '<p style="margin:0; color:var(--accent-3);">Failed to load department operating view.</p>';
    showNotice('Department operations view unavailable.', 'error');
  }
}

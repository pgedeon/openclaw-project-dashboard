export async function renderServiceRequestsView({
  state,
  mountNode,
  fetchImpl = fetch,
  escapeHtml,
  showNotice,
  getStateSync,
  formatTimestamp
}) {
  mountNode.innerHTML = '';

  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:16px;">
      <div>
        <h2 style="margin:0 0 6px 0;">🧾 Service Requests</h2>
        <p style="margin:0; color:var(--muted);">Create structured business requests, route them to the right department or agent, and launch matching workflow templates.</p>
      </div>
      <button id="serviceRequestsRefreshBtn" class="secondary-btn" type="button">Refresh</button>
    </div>
    <div id="serviceRequestsSummary" style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;"></div>
    <div style="display:grid; grid-template-columns:minmax(320px, 420px) minmax(0, 1fr); gap:16px; align-items:start;">
      <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft);">
        <h3 style="margin:0 0 12px 0;">New Request</h3>
        <form id="serviceRequestForm" style="display:grid; gap:12px;">
          <label style="display:grid; gap:6px;">
            <span>Service</span>
            <select id="serviceRequestService" required></select>
          </label>
          <label style="display:grid; gap:6px;">
            <span>Title</span>
            <input id="serviceRequestTitle" type="text" required placeholder="What needs to happen?">
          </label>
          <label style="display:grid; gap:6px;">
            <span>Description</span>
            <textarea id="serviceRequestDescription" rows="4" placeholder="Context, desired outcome, constraints"></textarea>
          </label>
          <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px;">
            <label style="display:grid; gap:6px;">
              <span>Requested by</span>
              <input id="serviceRequestRequestedBy" type="text" value="dashboard-operator" required>
            </label>
            <label style="display:grid; gap:6px;">
              <span>Priority</span>
              <select id="serviceRequestPriority">
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>
          <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px;">
            <label style="display:grid; gap:6px;">
              <span>Project ID</span>
              <input id="serviceRequestProjectId" type="text" placeholder="Optional board/project link">
            </label>
            <label style="display:grid; gap:6px;">
              <span>Task ID</span>
              <input id="serviceRequestTaskId" type="text" placeholder="Optional task link">
            </label>
          </div>
          <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px;">
            <label style="display:grid; gap:6px;">
              <span>Target department</span>
              <select id="serviceRequestDepartment"></select>
            </label>
            <label style="display:grid; gap:6px;">
              <span>Target agent</span>
              <select id="serviceRequestAgent"></select>
            </label>
          </div>
          <div id="serviceRequestIntakeFields" style="display:grid; gap:12px;"></div>
          <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button id="serviceRequestResetBtn" class="secondary-btn" type="button">Reset</button>
            <button class="add-btn" type="submit">Create Request</button>
          </div>
        </form>
      </section>
      <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
          <div>
            <h3 style="margin:0 0 4px 0;">Request Queue</h3>
            <p style="margin:0; color:var(--muted);">Filter by state, owner, department, or service type.</p>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin-bottom:12px;">
          <label style="display:grid; gap:6px;">
            <span>Status</span>
            <select id="serviceRequestsFilterStatus"></select>
          </label>
          <label style="display:grid; gap:6px;">
            <span>Department</span>
            <select id="serviceRequestsFilterDepartment"></select>
          </label>
          <label style="display:grid; gap:6px;">
            <span>Service</span>
            <select id="serviceRequestsFilterService"></select>
          </label>
          <label style="display:grid; gap:6px;">
            <span>Owner</span>
            <select id="serviceRequestsFilterOwner"></select>
          </label>
        </div>
        <div id="serviceRequestDetail" style="margin-bottom:12px;"></div>
        <div id="serviceRequestsList">Loading service requests...</div>
      </section>
    </div>
  `;
  mountNode.appendChild(container);

  const summaryEl = container.querySelector('#serviceRequestsSummary');
  const serviceSelect = container.querySelector('#serviceRequestService');
  const titleInput = container.querySelector('#serviceRequestTitle');
  const descriptionInput = container.querySelector('#serviceRequestDescription');
  const requestedByInput = container.querySelector('#serviceRequestRequestedBy');
  const prioritySelect = container.querySelector('#serviceRequestPriority');
  const projectIdInput = container.querySelector('#serviceRequestProjectId');
  const taskIdInput = container.querySelector('#serviceRequestTaskId');
  const departmentSelect = container.querySelector('#serviceRequestDepartment');
  const agentSelect = container.querySelector('#serviceRequestAgent');
  const intakeFieldsEl = container.querySelector('#serviceRequestIntakeFields');
  const form = container.querySelector('#serviceRequestForm');
  const resetBtn = container.querySelector('#serviceRequestResetBtn');
  const refreshBtn = container.querySelector('#serviceRequestsRefreshBtn');
  const listEl = container.querySelector('#serviceRequestsList');
  const detailEl = container.querySelector('#serviceRequestDetail');
  const filterStatus = container.querySelector('#serviceRequestsFilterStatus');
  const filterDepartment = container.querySelector('#serviceRequestsFilterDepartment');
  const filterService = container.querySelector('#serviceRequestsFilterService');
  const filterOwner = container.querySelector('#serviceRequestsFilterOwner');

  const currentProjectId = state?.project_id || (getStateSync ? getStateSync().project_id : '') || '';
  if (currentProjectId) {
    projectIdInput.value = currentProjectId;
  }

  let services = [];
  let serviceRequests = [];
  let departments = [];
  let agents = [];
  let workflowTemplates = [];
  let selectedRequestId = null;

  function renderSelectOptions(select, options, includeAllLabel = null) {
    const normalizedOptions = [];
    if (includeAllLabel) {
      normalizedOptions.push({ value: '', label: includeAllLabel });
    }
    options.forEach((option) => normalizedOptions.push(option));
    select.innerHTML = normalizedOptions
      .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('');
  }

  function getSelectedService() {
    return services.find((service) => service.id === serviceSelect.value) || null;
  }

  function renderIntakeFields() {
    const selectedService = getSelectedService();
    const fields = Array.isArray(selectedService?.intakeFields) ? selectedService.intakeFields : [];
    if (!fields.length) {
      intakeFieldsEl.innerHTML = '<p style="margin:0; color:var(--muted);">This service does not declare any extra intake fields.</p>';
      return;
    }
    intakeFieldsEl.innerHTML = fields.map((field) => {
      const fieldId = `intake-${field.name}`;
      if (field.type === 'textarea') {
        return `
          <label style="display:grid; gap:6px;">
            <span>${escapeHtml(field.label || field.name)}${field.required ? ' *' : ''}</span>
            <textarea id="${escapeHtml(fieldId)}" data-intake-field="${escapeHtml(field.name)}" rows="3" ${field.required ? 'required' : ''}></textarea>
          </label>
        `;
      }
      if (field.type === 'select') {
        const options = Array.isArray(field.options) ? field.options : [];
        return `
          <label style="display:grid; gap:6px;">
            <span>${escapeHtml(field.label || field.name)}${field.required ? ' *' : ''}</span>
            <select id="${escapeHtml(fieldId)}" data-intake-field="${escapeHtml(field.name)}" ${field.required ? 'required' : ''}>
              <option value="">Select...</option>
              ${options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}
            </select>
          </label>
        `;
      }
      return `
        <label style="display:grid; gap:6px;">
          <span>${escapeHtml(field.label || field.name)}${field.required ? ' *' : ''}</span>
          <input id="${escapeHtml(fieldId)}" data-intake-field="${escapeHtml(field.name)}" type="text" ${field.required ? 'required' : ''}>
        </label>
      `;
    }).join('');
  }

  function collectIntakePayload() {
    const payload = {};
    intakeFieldsEl.querySelectorAll('[data-intake-field]').forEach((input) => {
      const key = input.getAttribute('data-intake-field');
      if (!key) return;
      const value = input.value;
      if (value !== '') {
        payload[key] = value;
      }
    });
    return payload;
  }

  function renderSummaryCards() {
    const counts = serviceRequests.reduce((summary, item) => {
      summary.total += 1;
      summary[item.status] = (summary[item.status] || 0) + 1;
      return summary;
    }, { total: 0 });

    const cards = [
      { label: 'Total requests', value: counts.total || 0 },
      { label: 'New', value: counts.new || 0 },
      { label: 'Triaged / Planned', value: (counts.triaged || 0) + (counts.planned || 0) },
      { label: 'Running', value: counts.running || 0 }
    ];

    summaryEl.innerHTML = cards.map((card) => `
      <div style="background:var(--bg-2); border-radius:10px; padding:12px 14px; min-width:140px;">
        <div style="font-size:1.6em; font-weight:700;">${card.value}</div>
        <div style="color:var(--muted);">${escapeHtml(card.label)}</div>
      </div>
    `).join('');
  }

  function applyRequestFilters(items) {
    return items.filter((item) => {
      if (filterStatus.value && item.status !== filterStatus.value) return false;
      if (filterDepartment.value && (item.targetDepartmentId || item.targetDepartment?.id || item.service?.departmentId) !== filterDepartment.value) return false;
      if (filterService.value && item.serviceId !== filterService.value) return false;
      if (filterOwner.value && item.targetAgentId !== filterOwner.value) return false;
      return true;
    });
  }

  function getTemplateForRequest(item) {
    const templateName = item?.routingDecision?.workflow_template_name
      || item?.service?.workflowTemplateName
      || item?.currentWorkflowRun?.workflowType
      || null;
    if (!templateName) return null;
    return workflowTemplates.find((template) => template.name === templateName) || null;
  }

  function renderRequestDetail(item) {
    if (!item) {
      detailEl.innerHTML = `
        <div style="border:1px dashed var(--border); border-radius:12px; padding:14px; color:var(--muted); background:var(--bg-2);">
          Select a service request to inspect its workflow template, routing context, and linked run.
        </div>
      `;
      return;
    }

    const template = getTemplateForRequest(item);
    const currentRun = item.currentWorkflowRun || null;
    const resolvedDepartment = item.targetDepartment?.name || item.service?.department?.name || 'Unassigned';
    const runStatusLabel = currentRun?.statusInfo?.label || (currentRun?.status ? currentRun.status.replace(/_/g, ' ') : null);
    const templateSteps = Array.isArray(template?.steps) ? template.steps : [];
    const requiredApprovals = Array.isArray(template?.requiredApprovals)
      ? template.requiredApprovals
      : Array.isArray(template?.required_approvals)
        ? template.required_approvals
        : [];

    detailEl.innerHTML = `
      <div style="border:1px solid var(--border); border-radius:12px; padding:14px; background:var(--bg-2); display:grid; gap:14px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
          <div>
            <div style="font-size:0.82em; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted);">Selected request</div>
            <h4 style="margin:4px 0 6px 0;">${escapeHtml(item.title)}</h4>
            <div style="color:var(--muted); font-size:0.92em;">${escapeHtml(item.description || 'No description')}</div>
            <div style="color:var(--muted); font-size:0.88em; margin-top:6px;">Service: ${escapeHtml(item.service?.name || 'Unknown')} · Department: ${escapeHtml(resolvedDepartment)}</div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="secondary-btn" type="button" data-service-request-route="${escapeHtml(item.id)}">Route</button>
            <button class="secondary-btn" type="button" data-service-request-launch="${escapeHtml(item.id)}">Launch</button>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px;">
          <div style="border:1px solid var(--border); border-radius:10px; padding:12px; background:var(--surface);">
            <div style="font-size:0.82em; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); margin-bottom:6px;">Workflow template</div>
            ${template ? `
              <div style="font-weight:700;">${escapeHtml(template.displayName || template.display_name || template.name)}</div>
              <div style="color:var(--muted); font-size:0.92em; margin-top:4px;">Owner: ${escapeHtml(template.defaultOwnerAgent || template.default_owner_agent || 'Unassigned')}</div>
              <div style="color:var(--muted); font-size:0.92em;">Steps: ${templateSteps.length}</div>
              <div style="color:var(--muted); font-size:0.92em;">Category: ${escapeHtml(template.uiCategory || template.ui_category || template.category || 'general')}</div>
              <div style="color:var(--muted); font-size:0.92em;">Approvals: ${escapeHtml(requiredApprovals.length ? requiredApprovals.join(', ') : 'None')}</div>
              <div style="color:var(--muted); font-size:0.92em;">Runbook: ${template.runbookRef ? `<a href="/api/runbook/${encodeURIComponent(template.runbookRef)}" target="_blank" rel="noreferrer">${escapeHtml(template.runbookRef)}</a>` : 'Not linked'}</div>
            ` : `
              <div style="color:var(--muted);">No matching workflow template metadata is available yet for this request.</div>
            `}
          </div>
          <div style="border:1px solid var(--border); border-radius:10px; padding:12px; background:var(--surface);">
            <div style="font-size:0.82em; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); margin-bottom:6px;">Linked workflow run</div>
            ${currentRun ? `
              <div style="font-weight:700;">${escapeHtml(currentRun.id)}</div>
              <div style="color:var(--muted); font-size:0.92em; margin-top:4px;">Status: ${escapeHtml(runStatusLabel || 'Unknown')}</div>
              <div style="color:var(--muted); font-size:0.92em;">Step: ${escapeHtml(currentRun.currentStep || 'Not started')}</div>
              <div style="color:var(--muted); font-size:0.92em;">Owner: ${escapeHtml(currentRun.ownerAgentId || 'Unassigned')}</div>
              <div style="color:var(--muted); font-size:0.92em;">Trace: Request → Run → ${escapeHtml(currentRun.taskTitle || item.linkedTaskTitle || 'Task pending')}</div>
            ` : `
              <div style="color:var(--muted);">No workflow run has been launched from this request yet.</div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  function attachRequestActions() {
    container.querySelectorAll('[data-service-request-select]').forEach((button) => {
      if (button.dataset.requestBound === 'true') return;
      button.dataset.requestBound = 'true';
      button.addEventListener('click', () => {
        selectedRequestId = button.getAttribute('data-service-request-select');
        renderRequestList();
      });
    });

    container.querySelectorAll('[data-service-request-route]').forEach((button) => {
      if (button.dataset.requestBound === 'true') return;
      button.dataset.requestBound = 'true';
      button.addEventListener('click', async () => {
        button.disabled = true;
        const requestId = button.getAttribute('data-service-request-route');
        try {
          const response = await fetchImpl(`/api/service-requests/${requestId}/route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ routed_by: 'dashboard-operator' })
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || `Route failed with status ${response.status}`);
          }
          showNotice('Service request routed.', 'success');
          await reloadData();
        } catch (error) {
          console.error('[ServiceRequests] Route failed:', error);
          showNotice(error.message || 'Failed to route service request.', 'error');
        } finally {
          button.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-service-request-launch]').forEach((button) => {
      if (button.dataset.requestBound === 'true') return;
      button.dataset.requestBound = 'true';
      button.addEventListener('click', async () => {
        button.disabled = true;
        const requestId = button.getAttribute('data-service-request-launch');
        try {
          const response = await fetchImpl(`/api/service-requests/${requestId}/launch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ launched_by: 'dashboard-operator' })
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || `Launch failed with status ${response.status}`);
          }
          showNotice(`Workflow launched: ${payload.workflowRun.workflow_type}`, 'success');
          await reloadData();
        } catch (error) {
          console.error('[ServiceRequests] Launch failed:', error);
          showNotice(error.message || 'Failed to launch service request.', 'error');
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function renderRequestList() {
    const filtered = applyRequestFilters(serviceRequests);
    if (!filtered.length) {
      selectedRequestId = null;
      renderRequestDetail(null);
      listEl.innerHTML = '<p style="margin:0; color:var(--muted);">No service requests match the current filters.</p>';
      return;
    }

    if (!selectedRequestId || !filtered.some((item) => item.id === selectedRequestId)) {
      selectedRequestId = filtered[0].id;
    }

    const selectedRequest = filtered.find((item) => item.id === selectedRequestId) || filtered[0];
    renderRequestDetail(selectedRequest);

    listEl.innerHTML = `
      <div style="overflow:auto;">
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:var(--bg-2);">
              <th style="text-align:left; padding:8px;">Request</th>
              <th style="text-align:left; padding:8px;">Service</th>
              <th style="text-align:left; padding:8px;">Status</th>
              <th style="text-align:left; padding:8px;">Route</th>
              <th style="text-align:left; padding:8px;">Links</th>
              <th style="text-align:left; padding:8px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map((item) => `
              <tr style="border-bottom:1px solid var(--border); vertical-align:top; ${item.id === selectedRequestId ? 'background:var(--bg-2);' : ''}">
                <td style="padding:10px;">
                  <div style="font-weight:700;">${escapeHtml(item.title)}</div>
                  <div style="color:var(--muted); font-size:0.92em;">${escapeHtml(item.description || 'No description')}</div>
                  <div style="color:var(--muted); font-size:0.85em; margin-top:4px;">Requested by ${escapeHtml(item.requestedBy)} · ${escapeHtml(formatTimestamp(item.createdAt))}</div>
                </td>
                <td style="padding:10px;">
                  <div>${escapeHtml(item.service?.name || item.serviceId || 'Unknown service')}</div>
                  <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.service?.department?.name || item.targetDepartment?.name || 'Unassigned')}</div>
                </td>
                <td style="padding:10px;">
                  <span style="display:inline-flex; padding:4px 8px; border-radius:999px; background:var(--bg-2);">${escapeHtml((item.status || 'new').replace(/_/g, ' '))}</span>
                  <div style="color:var(--muted); font-size:0.9em; margin-top:6px;">Priority: ${escapeHtml(item.priority || 'medium')}</div>
                </td>
                <td style="padding:10px;">
                  <div>${escapeHtml(item.targetDepartment?.name || item.service?.department?.name || 'No department')}</div>
                  <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(item.targetAgentId || item.service?.defaultAgentId || 'No agent')}</div>
                </td>
                <td style="padding:10px;">
                  <div style="font-size:0.92em;">Project: ${escapeHtml(item.projectId || item.linkedProjectName || 'None')}</div>
                  <div style="font-size:0.92em; color:var(--muted);">Task: ${escapeHtml(item.taskId || item.linkedTaskTitle || 'None')}</div>
                  ${item.currentWorkflowRunId ? `<div style="font-size:0.92em; color:var(--success); margin-top:6px;">Run: ${escapeHtml(item.currentWorkflowRunId)}</div>` : ''}
                </td>
                <td style="padding:10px;">
                  <div style="display:flex; flex-wrap:wrap; gap:8px;">
                    <button class="secondary-btn" type="button" data-service-request-select="${escapeHtml(item.id)}">Details</button>
                    <button class="secondary-btn" type="button" data-service-request-route="${escapeHtml(item.id)}">Route</button>
                    <button class="secondary-btn" type="button" data-service-request-launch="${escapeHtml(item.id)}">Launch</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    attachRequestActions();
  }

  function resetFormFields() {
    titleInput.value = '';
    descriptionInput.value = '';
    taskIdInput.value = '';
    prioritySelect.value = 'medium';
    requestedByInput.value = 'dashboard-operator';
    departmentSelect.value = '';
    agentSelect.value = '';
    if (currentProjectId) {
      projectIdInput.value = currentProjectId;
    } else {
      projectIdInput.value = '';
    }
    renderIntakeFields();
  }

  function syncCatalogControls() {
    renderSelectOptions(
      serviceSelect,
      services.map((service) => ({
        value: service.id,
        label: service.department?.name ? `${service.name} · ${service.department.name}` : service.name
      }))
    );

    renderSelectOptions(
      departmentSelect,
      [{ value: '', label: 'Use service default' }].concat(
        departments.map((department) => ({ value: department.id, label: department.name }))
      )
    );

    renderSelectOptions(
      agentSelect,
      [{ value: '', label: 'Use service default' }].concat(
        agents.map((agent) => ({ value: agent.agentId || agent.id, label: agent.displayName || agent.name || agent.agentId || agent.id }))
      )
    );

    renderSelectOptions(filterStatus, [
      { value: 'new', label: 'New' },
      { value: 'triaged', label: 'Triaged' },
      { value: 'planned', label: 'Planned' },
      { value: 'running', label: 'Running' },
      { value: 'waiting_for_approval', label: 'Waiting for approval' },
      { value: 'blocked', label: 'Blocked' },
      { value: 'completed', label: 'Completed' },
      { value: 'failed', label: 'Failed' },
      { value: 'cancelled', label: 'Cancelled' }
    ], 'All statuses');

    renderSelectOptions(
      filterDepartment,
      departments.map((department) => ({ value: department.id, label: department.name })),
      'All departments'
    );

    renderSelectOptions(
      filterService,
      services.map((service) => ({ value: service.id, label: service.name })),
      'All services'
    );

    renderSelectOptions(
      filterOwner,
      agents.map((agent) => ({ value: agent.agentId || agent.id, label: agent.displayName || agent.name || agent.agentId || agent.id })),
      'All owners'
    );

    if (services.length) {
      serviceSelect.value = services[0].id;
    }
    renderIntakeFields();
  }

  async function reloadData() {
    const [servicesRes, requestsRes, departmentsRes, agentsRes, templatesRes] = await Promise.all([
      fetchImpl('/api/services', { headers: { Accept: 'application/json' } }),
      fetchImpl(`/api/service-requests?limit=200${currentProjectId ? `&project_id=${encodeURIComponent(currentProjectId)}` : ''}`, { headers: { Accept: 'application/json' } }),
      fetchImpl('/api/org/departments', { headers: { Accept: 'application/json' } }),
      fetchImpl('/api/org/agents', { headers: { Accept: 'application/json' } }),
      fetchImpl('/api/workflow-templates', { headers: { Accept: 'application/json' } })
    ]);

    if (!servicesRes.ok || !requestsRes.ok || !departmentsRes.ok || !agentsRes.ok) {
      throw new Error('One or more service request endpoints failed');
    }

    const [servicesData, requestsData, departmentsData, agentsData, templatesData] = await Promise.all([
      servicesRes.json(),
      requestsRes.json(),
      departmentsRes.json(),
      agentsRes.json(),
      templatesRes.ok ? templatesRes.json() : Promise.resolve({ templates: [] })
    ]);

    services = Array.isArray(servicesData.services) ? servicesData.services : [];
    serviceRequests = Array.isArray(requestsData.serviceRequests) ? requestsData.serviceRequests : [];
    departments = Array.isArray(departmentsData) ? departmentsData : [];
    agents = Array.isArray(agentsData) ? agentsData : [];
    workflowTemplates = Array.isArray(templatesData.templates) ? templatesData.templates : [];

    syncCatalogControls();
    renderSummaryCards();
    renderRequestList();
  }

  serviceSelect.addEventListener('change', renderIntakeFields);
  [filterStatus, filterDepartment, filterService, filterOwner].forEach((select) => {
    select.addEventListener('change', renderRequestList);
  });

  resetBtn.addEventListener('click', () => {
    resetFormFields();
  });

  refreshBtn.addEventListener('click', async () => {
    try {
      await reloadData();
      showNotice('Service requests refreshed.', 'success');
    } catch (error) {
      console.error('[ServiceRequests] Refresh failed:', error);
      showNotice('Failed to refresh service requests.', 'error');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selectedService = getSelectedService();
    if (!selectedService) {
      showNotice('Select a service before creating a request.', 'error');
      return;
    }

    const payload = {
      service_id: selectedService.id,
      project_id: projectIdInput.value.trim() || null,
      task_id: taskIdInput.value.trim() || null,
      requested_by: requestedByInput.value.trim() || 'dashboard-operator',
      title: titleInput.value.trim(),
      description: descriptionInput.value.trim(),
      priority: prioritySelect.value,
      target_department_id: departmentSelect.value || null,
      target_agent_id: agentSelect.value || null,
      input_payload: collectIntakePayload()
    };

    try {
      const response = await fetchImpl('/api/service-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || `Create failed with status ${response.status}`);
      }
      showNotice('Service request created.', 'success');
      resetFormFields();
      await reloadData();
    } catch (error) {
      console.error('[ServiceRequests] Create failed:', error);
      showNotice(error.message || 'Failed to create service request.', 'error');
    }
  });

  try {
    await reloadData();
  } catch (error) {
    console.error('[ServiceRequests] Initial load failed:', error);
    summaryEl.innerHTML = '';
    listEl.innerHTML = '<p style="margin:0; color:var(--accent-3);">Failed to load service request data.</p>';
    showNotice('Service requests view unavailable.', 'error');
  }
}

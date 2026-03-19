export async function renderApprovalsView({
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
        <h2 style="margin:0 0 6px 0;">✅ Approvals</h2>
        <p style="margin:0; color:var(--muted);">Review pending approvals, inspect linked workflow runs and artifacts, then approve, reject, or escalate with a decision note.</p>
      </div>
      <button id="approvalsRefreshBtn" class="secondary-btn" type="button">Refresh</button>
    </div>
    <div id="approvalsSummary" style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;"></div>
    <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft);">
      <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin-bottom:12px;">
        <label style="display:grid; gap:6px;">
          <span>Approver</span>
          <select id="approvalsFilterApprover"></select>
        </label>
        <label style="display:grid; gap:6px;">
          <span>Workflow</span>
          <select id="approvalsFilterWorkflow"></select>
        </label>
        <label style="display:grid; gap:6px;">
          <span>Approval Type</span>
          <select id="approvalsFilterType"></select>
        </label>
        <label style="display:grid; gap:6px;">
          <span>Due Window</span>
          <select id="approvalsFilterDue">
            <option value="">All approvals</option>
            <option value="overdue">Overdue</option>
            <option value="due_today">Due today</option>
            <option value="scheduled">Scheduled</option>
            <option value="unscheduled">No due date</option>
          </select>
        </label>
      </div>
      <div id="approvalsList">Loading approvals...</div>
    </section>
  `;
  mountNode.appendChild(container);

  const summaryEl = container.querySelector('#approvalsSummary');
  const listEl = container.querySelector('#approvalsList');
  const refreshBtn = container.querySelector('#approvalsRefreshBtn');
  const approverFilter = container.querySelector('#approvalsFilterApprover');
  const workflowFilter = container.querySelector('#approvalsFilterWorkflow');
  const typeFilter = container.querySelector('#approvalsFilterType');
  const dueFilter = container.querySelector('#approvalsFilterDue');

  let approvals = [];

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

  function matchesDueFilter(approval) {
    if (!dueFilter.value) return true;
    if (dueFilter.value === 'overdue') return Boolean(approval.overdue);
    if (dueFilter.value === 'unscheduled') return !approval.dueAt;
    if (dueFilter.value === 'scheduled') return Boolean(approval.dueAt);
    if (dueFilter.value === 'due_today') {
      if (!approval.dueAt) return false;
      const due = new Date(approval.dueAt);
      const now = new Date();
      return due.toDateString() === now.toDateString();
    }
    return true;
  }

  function filteredApprovals() {
    return approvals.filter((approval) => {
      if (approverFilter.value && approval.approverId !== approverFilter.value) return false;
      if (workflowFilter.value && approval.workflowType !== workflowFilter.value) return false;
      if (typeFilter.value && approval.approvalType !== typeFilter.value) return false;
      if (!matchesDueFilter(approval)) return false;
      return true;
    });
  }

  function renderSummary() {
    const items = filteredApprovals();
    const overdue = items.filter((approval) => approval.overdue).length;
    const escalated = items.filter((approval) => approval.escalatedAt || approval.escalatedTo).length;
    const artifactLinked = items.filter((approval) => approval.artifact?.id).length;

    summaryEl.innerHTML = [
      { label: 'Visible approvals', value: items.length },
      { label: 'Overdue', value: overdue },
      { label: 'Escalated', value: escalated },
      { label: 'Artifact-linked', value: artifactLinked }
    ].map((card) => `
      <div style="background:var(--bg-2); border-radius:10px; padding:12px 14px; min-width:140px;">
        <div style="font-size:1.6em; font-weight:700;">${card.value}</div>
        <div style="color:var(--muted);">${escapeHtml(card.label)}</div>
      </div>
    `).join('');
  }

  function renderList() {
    const items = filteredApprovals();
    renderSummary();

    if (!items.length) {
      listEl.innerHTML = '<p style="margin:0; color:var(--muted);">No pending approvals match the current filters.</p>';
      return;
    }

    listEl.innerHTML = `
      <div style="display:grid; gap:12px;">
        ${items.map((approval) => `
          <article style="border:1px solid var(--border); border-radius:12px; padding:14px; background:var(--bg-2); display:grid; gap:12px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
              <div>
                <div style="font-size:0.82em; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted);">Approval Inbox</div>
                <h3 style="margin:4px 0 6px 0;">${escapeHtml(approval.stepName || approval.approvalType || 'Approval')}</h3>
                <div style="color:var(--muted); font-size:0.92em;">${escapeHtml(approval.workflowType || 'Unknown workflow')} • Requested by ${escapeHtml(approval.ownerAgentId || approval.requestedBy || 'system')}</div>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <span style="display:inline-flex; padding:4px 10px; border-radius:999px; background:${approval.overdue ? 'rgba(220, 38, 38, 0.12)' : 'var(--surface)'}; border:1px solid var(--border); font-size:0.88em;">
                  ${escapeHtml(approval.statusInfo?.icon || '🛂')} ${escapeHtml(approval.statusInfo?.label || 'Pending')}
                </span>
                ${approval.overdue ? '<span style="color:var(--danger); font-size:0.9em; font-weight:600;">Overdue</span>' : ''}
              </div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px;">
              <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px;">
                <div style="font-size:0.8em; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:4px;">Run</div>
                <div style="font-weight:700;">${escapeHtml(approval.workflowRunId || 'Unknown')}</div>
                <div style="color:var(--muted); font-size:0.9em; margin-top:4px;">Task: ${escapeHtml(approval.taskTitle || approval.taskId || 'No linked task')}</div>
              </div>
              <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px;">
                <div style="font-size:0.8em; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:4px;">Ownership</div>
                <div style="font-weight:700;">Approver: ${escapeHtml(approval.approverId || 'unassigned')}</div>
                <div style="color:var(--muted); font-size:0.9em; margin-top:4px;">Requested by ${escapeHtml(approval.requestedBy || 'system')}</div>
              </div>
              <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px;">
                <div style="font-size:0.8em; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:4px;">Due</div>
                <div style="font-weight:700;">${escapeHtml(approval.dueAt ? formatTimestamp(approval.dueAt) : 'No due date')}</div>
                <div style="color:var(--muted); font-size:0.9em; margin-top:4px;">Type: ${escapeHtml((approval.approvalType || 'step_gate').replace(/_/g, ' '))}</div>
              </div>
            </div>
            ${approval.artifact ? `
              <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px; display:grid; gap:6px;">
                <div style="font-size:0.8em; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted);">Artifact Preview</div>
                <div style="font-weight:700;">${escapeHtml(approval.artifact.label || approval.artifact.uri || 'Linked artifact')}</div>
                <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(approval.artifact.artifactType || 'artifact')} • ${escapeHtml(approval.artifact.status || 'generated')}</div>
                <div style="font-size:0.92em; word-break:break-word;">
                  <a href="${escapeHtml(approval.artifact.uri || '#')}" target="_blank" rel="noreferrer">${escapeHtml(approval.artifact.uri || 'Open artifact')}</a>
                </div>
              </div>
            ` : ''}
            <div style="display:grid; gap:8px;">
              <label style="display:grid; gap:6px;">
                <span>Decision note${approval.requiredNote ? ' *' : ''}</span>
                <textarea data-approval-note="${escapeHtml(approval.id)}" rows="3" placeholder="Explain the approval or rejection decision"></textarea>
              </label>
              <div style="display:grid; grid-template-columns:minmax(0, 220px) minmax(0, 1fr); gap:10px; align-items:start;">
                <label style="display:grid; gap:6px;">
                  <span>Escalate to</span>
                  <input data-approval-escalate-target="${escapeHtml(approval.id)}" type="text" placeholder="manager-agent-id">
                </label>
                <label style="display:grid; gap:6px;">
                  <span>Escalation reason</span>
                  <input data-approval-escalate-reason="${escapeHtml(approval.id)}" type="text" placeholder="Why this approval needs escalation">
                </label>
              </div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
              <button class="secondary-btn" type="button" data-approval-open-run="${escapeHtml(approval.workflowRunId || '')}">Open Run</button>
              <button class="secondary-btn" type="button" data-approval-escalate="${escapeHtml(approval.id)}">Escalate</button>
              <button class="secondary-btn" type="button" data-approval-reject="${escapeHtml(approval.id)}">Reject</button>
              <button class="add-btn" type="button" data-approval-approve="${escapeHtml(approval.id)}">Approve</button>
            </div>
          </article>
        `).join('')}
      </div>
    `;

    listEl.querySelectorAll('[data-approval-open-run]').forEach((button) => {
      button.addEventListener('click', () => {
        const runId = button.getAttribute('data-approval-open-run');
        if (runId && showSessionDetails) {
          showSessionDetails(runId);
        }
      });
    });

    listEl.querySelectorAll('[data-approval-approve]').forEach((button) => {
      button.addEventListener('click', async () => {
        const approvalId = button.getAttribute('data-approval-approve');
        const noteInput = listEl.querySelector(`[data-approval-note="${approvalId}"]`);
        const notes = noteInput?.value || '';
        if (!notes.trim()) {
          showNotice('Decision note is required for approval actions.', 'error');
          noteInput?.focus();
          return;
        }

        button.disabled = true;
        try {
          const response = await fetchImpl(`/api/approvals/${approvalId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ decision: 'approved', notes, decided_by: 'dashboard-operator' })
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || `Approval failed with status ${response.status}`);
          }
          showNotice('Approval recorded.', 'success');
          await loadApprovals();
        } catch (error) {
          console.error('[Approvals] Approval failed:', error);
          showNotice(error.message || 'Failed to approve item.', 'error');
        } finally {
          button.disabled = false;
        }
      });
    });

    listEl.querySelectorAll('[data-approval-reject]').forEach((button) => {
      button.addEventListener('click', async () => {
        const approvalId = button.getAttribute('data-approval-reject');
        const noteInput = listEl.querySelector(`[data-approval-note="${approvalId}"]`);
        const notes = noteInput?.value || '';
        if (!notes.trim()) {
          showNotice('Decision note is required for rejection.', 'error');
          noteInput?.focus();
          return;
        }

        button.disabled = true;
        try {
          const response = await fetchImpl(`/api/approvals/${approvalId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ decision: 'rejected', notes, decided_by: 'dashboard-operator' })
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || `Rejection failed with status ${response.status}`);
          }
          showNotice('Approval rejected.', 'success');
          await loadApprovals();
        } catch (error) {
          console.error('[Approvals] Rejection failed:', error);
          showNotice(error.message || 'Failed to reject item.', 'error');
        } finally {
          button.disabled = false;
        }
      });
    });

    listEl.querySelectorAll('[data-approval-escalate]').forEach((button) => {
      button.addEventListener('click', async () => {
        const approvalId = button.getAttribute('data-approval-escalate');
        const targetInput = listEl.querySelector(`[data-approval-escalate-target="${approvalId}"]`);
        const reasonInput = listEl.querySelector(`[data-approval-escalate-reason="${approvalId}"]`);
        const escalatedTo = targetInput?.value || '';
        const reason = reasonInput?.value || '';
        if (!escalatedTo.trim()) {
          showNotice('Provide an escalation target before escalating.', 'error');
          targetInput?.focus();
          return;
        }

        button.disabled = true;
        try {
          const response = await fetchImpl(`/api/approvals/${approvalId}/escalate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ escalated_to: escalatedTo.trim(), reason: reason.trim(), actor: 'dashboard-operator' })
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || `Escalation failed with status ${response.status}`);
          }
          showNotice('Approval escalated.', 'success');
          await loadApprovals();
        } catch (error) {
          console.error('[Approvals] Escalation failed:', error);
          showNotice(error.message || 'Failed to escalate approval.', 'error');
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  async function loadApprovals() {
    const response = await fetchImpl('/api/approvals/pending', { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Approvals request failed with status ${response.status}`);
    }

    const payload = await response.json();
    approvals = Array.isArray(payload.approvals) ? payload.approvals : [];

    renderOptions(approverFilter, [...new Set(approvals.map((approval) => approval.approverId))], 'All approvers');
    renderOptions(workflowFilter, [...new Set(approvals.map((approval) => approval.workflowType))], 'All workflows');
    renderOptions(typeFilter, [...new Set(approvals.map((approval) => approval.approvalType))], 'All approval types');
    renderList();
  }

  [approverFilter, workflowFilter, typeFilter, dueFilter].forEach((select) => {
    select.addEventListener('change', renderList);
  });

  refreshBtn.addEventListener('click', async () => {
    try {
      await loadApprovals();
      showNotice('Approvals refreshed.', 'success');
    } catch (error) {
      console.error('[Approvals] Refresh failed:', error);
      showNotice('Failed to refresh approvals.', 'error');
    }
  });

  try {
    await loadApprovals();
  } catch (error) {
    console.error('[Approvals] Initial load failed:', error);
    listEl.innerHTML = '<p style="margin:0; color:var(--accent-3);">Failed to load approvals.</p>';
    summaryEl.innerHTML = '';
    showNotice('Approvals view unavailable.', 'error');
  }
}

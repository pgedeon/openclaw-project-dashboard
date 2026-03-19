export async function renderPublishView({
  mountNode,
  fetchImpl = fetch,
  escapeHtml,
  showSessionDetails,
  openVerificationModal,
  navigateToView
}) {
  mountNode.innerHTML = '';

  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';

  const header = document.createElement('div');
  header.innerHTML = '<h2 style="margin:0 0 16px 0;">Publish Center</h2>';
  container.appendChild(header);

  const summary = document.createElement('div');
  summary.style.cssText = 'display:flex; gap:16px; margin-bottom:16px; flex-wrap:wrap;';
  container.appendChild(summary);

  const tasksContainer = document.createElement('div');
  tasksContainer.id = 'publish-tasks';
  container.appendChild(tasksContainer);

  mountNode.appendChild(container);

  try {
    const response = await fetchImpl('/api/tasks/all');
    if (!response.ok) throw new Error('Failed to fetch tasks');

    const data = await response.json();
    let tasks = Array.isArray(data?.tasks) ? data.tasks : (Array.isArray(data) ? data : []);
    tasks = tasks.filter((task) => task?.active_workflow_run_id);

    if (!tasks.length) {
      tasksContainer.innerHTML = '<p style="color:var(--muted);">No tasks with active workflow runs.</p>';
      return;
    }

    const runs = await Promise.all(
      tasks.map((task) =>
        fetchImpl(`/api/workflow-runs/${task.active_workflow_run_id}`)
          .then((result) => (result.ok ? result.json() : null))
          .catch(() => null)
      )
    );

    const taskRuns = tasks
      .map((task, index) => ({ task, run: runs[index] }))
      .filter((entry) => entry.run);

    if (!taskRuns.length) {
      tasksContainer.innerHTML = '<p style="color:var(--muted);">No workflow run details are available for active publish work.</p>';
      return;
    }

    const statusCounts = {};
    let totalArtifacts = 0;
    taskRuns.forEach(({ run }) => {
      const status = run.status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      totalArtifacts += Number(run.actualArtifactCount ?? run.actual_artifact_count) || 0;
    });

    summary.innerHTML = Object.entries(statusCounts)
      .map(([status, count]) => {
        return `<div style="padding:8px 12px; background:var(--bg-2); border-radius:6px;"><strong>${escapeHtml(status)}</strong>: ${escapeHtml(count)}</div>`;
      })
      .join('') + `<div style="padding:8px 12px; background:var(--bg-2); border-radius:6px;"><strong>Artifacts</strong>: ${escapeHtml(totalArtifacts)}</div>`;

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; background:var(--surface);';
    table.innerHTML = `
      <thead>
        <tr style="border-bottom:2px solid var(--border); background:var(--bg-2);">
          <th style="text-align:left; padding:10px;">Task</th>
          <th style="text-align:left; padding:10px;">Workflow</th>
          <th style="text-align:left; padding:10px;">Current Step</th>
          <th style="text-align:left; padding:10px;">Status</th>
          <th style="text-align:left; padding:10px;">Artifacts</th>
          <th style="text-align:left; padding:10px;">Agent</th>
          <th style="text-align:left; padding:10px;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${taskRuns.map(({ task, run }) => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:10px;">
              <button class="secondary-btn" type="button" data-publish-open-board="${escapeHtml(task.id || '')}" style="font-size:0.85em; padding:4px 8px;">
                ${escapeHtml(task.title || 'Untitled task')}
              </button>
            </td>
            <td style="padding:10px;">${escapeHtml(run.workflow_type || run.workflowType || 'Unknown')}</td>
            <td style="padding:10px;">${escapeHtml(run.current_step ? String(run.current_step).replace(/_/g, ' ') : '-') }</td>
            <td style="padding:10px;">${escapeHtml(run.status || 'unknown')}</td>
            <td style="padding:10px;">${escapeHtml(Number(run.actualArtifactCount ?? run.actual_artifact_count) || 0)} / ${escapeHtml(Number(run.expectedArtifactCount ?? run.expected_artifact_count) || 0)}</td>
            <td style="padding:10px;">${escapeHtml(run.owner_agent_id || run.ownerAgentId || 'Unassigned')}</td>
            <td style="padding:10px;">
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button class="secondary-btn" type="button" data-publish-details="${escapeHtml(run.id || '')}" style="font-size:0.85em; padding:4px 8px;">Details</button>
                ${run.status === 'completed' && !run.output_summary?.verified ? `
                  <button class="secondary-btn" type="button" data-publish-verify-run="${escapeHtml(run.id || '')}" data-publish-verify-task="${escapeHtml(task.title || '')}" style="font-size:0.85em; padding:4px 8px; background:var(--accent); color:var(--bg);">
                    Verify
                  </button>
                ` : ''}
                ${run.output_summary?.verified ? '<span style="align-self:center; color:var(--muted); font-size:0.9em;">Verified</span>' : ''}
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;

    tasksContainer.appendChild(table);

    tasksContainer.querySelectorAll('[data-publish-open-board]').forEach((button) => {
      button.addEventListener('click', async () => {
        await navigateToView?.('board');
      });
    });

    tasksContainer.querySelectorAll('[data-publish-details]').forEach((button) => {
      button.addEventListener('click', () => {
        const runId = button.getAttribute('data-publish-details');
        if (runId) {
          showSessionDetails?.(runId);
        }
      });
    });

    tasksContainer.querySelectorAll('[data-publish-verify-run]').forEach((button) => {
      button.addEventListener('click', () => {
        const runId = button.getAttribute('data-publish-verify-run');
        const taskTitle = button.getAttribute('data-publish-verify-task') || 'Task';
        if (runId) {
          openVerificationModal?.(runId, taskTitle);
        }
      });
    });
  } catch (error) {
    console.error('[Publish Center] Error:', error);
    tasksContainer.innerHTML = '<p style="color:var(--accent-3);">Failed to load publish data.</p>';
  }
}

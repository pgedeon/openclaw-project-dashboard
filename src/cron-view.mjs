/**
 * Cron Jobs View for OpenClaw Dashboard
 *
 * Displays scheduled cron jobs from the crontab directory.
 * Shows job name, schedule, last run time, status, exit code, duration, and recent run output.
 * Allows manual execution of jobs.
 */

export class CronView {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      refreshInterval: 30000, // Refresh every 30 seconds
      ...options
    };
    this.jobs = [];
    this.expandedJobId = null; // ID of job with expanded log view
    this.refreshTimer = null;
  }

  /**
   * Load cron jobs from the API
   */
  async load() {
    try {
      const res = await fetch('/api/cron/jobs');
      if (!res.ok) throw new Error(`Failed to fetch cron jobs: ${res.statusText}`);
      const data = await res.json();
      this.jobs = data.jobs || [];
      this.render();
    } catch (err) {
      console.error('[CronView] Load error:', err);
      this.container.innerHTML = `<div class="error-state"><p>Failed to load cron jobs: ${err.message}</p></div>`;
    }
  }

  /**
   * Render the cron view
   */
  render() {
    this.container.innerHTML = '';
    this.container.className = 'cron-view';

    if (this.jobs.length === 0) {
      this.container.innerHTML = '<div class="empty-state"><p>No cron jobs defined.</p></div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'cron-table';
    table.style.cssText = 'width: 100%; border-collapse: collapse; background: var(--surface, white); border-radius: 8px; overflow: hidden;';

    // Header with additional columns
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr style="background: var(--surface-2, #f0f0f0); text-align: left;">
        <th style="padding: 12px; border-bottom: 1px solid var(--border, #ddd);">Job</th>
        <th style="padding: 12px; border-bottom: 1px solid var(--border, #ddd);">Schedule</th>
        <th style="padding: 12px; border-bottom: 1px solid var(--border, #ddd);">Last Run</th>
        <th style="padding: 12px; border-bottom: 1px solid var(--border, #ddd);">Status</th>
        <th style="padding: 12px; border-bottom: 1px solid var(--border, #ddd);">Exit Code</th>
        <th style="padding: 12px; border-bottom: 1px solid var(--border, #ddd);">Duration</th>
        <th style="padding: 12px; border-bottom: 1px solid var(--border, #ddd);">Actions</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    this.jobs.forEach(job => {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom: 1px solid var(--border, #eee);';

      // Determine status display
      let statusHtml;
      if (job.lastRunStatus === 'success') {
        statusHtml = '<span style="color: var(--success, #20b26c); font-weight: 600;">● Success</span>';
      } else if (job.lastRunStatus === 'failure') {
        statusHtml = '<span style="color: var(--danger, #e03131); font-weight: 600;">● Failed</span>';
      } else {
        statusHtml = '<span style="color: var(--muted, #999);">● Unknown</span>';
      }

      // Format duration
      const durationStr = job.lastDurationMs ? this.formatDuration(job.lastDurationMs) : '-';

      // Escape values
      const name = this.escapeHtml(job.name);
      const jobIdEsc = this.escapeHtml(job.id);
      const schedule = this.escapeHtml(job.schedule);
      const lastRunText = job.lastRun ? new Date(job.lastRun).toLocaleString() : '<span style="color: var(--muted, #999);">Never</span>';
      const exitCode = job.lastExitCode !== null && job.lastExitCode !== undefined ? job.lastExitCode : '-';

      tr.innerHTML = `
        <td style="padding: 12px;">
          <strong>${name}</strong>
          <div style="font-size: 0.85rem; color: var(--muted, #666); margin-top: 4px;">${jobIdEsc}</div>
        </td>
        <td style="padding: 12px; font-family: monospace;">${schedule}</td>
        <td style="padding: 12px;">${lastRunText}</td>
        <td style="padding: 12px;">${statusHtml}</td>
        <td style="padding: 12px; font-family: monospace;">${exitCode}</td>
        <td style="padding: 12px;">${durationStr}</td>
        <td style="padding: 12px;">
          <button class="run-now-btn" data-job-id="${jobIdEsc}" style="background: var(--accent, #5c6bf2); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.9rem;">Run Now</button>
          <button class="show-logs-btn" data-job-id="${jobIdEsc}" style="background: var(--surface-2, #f0f0f0); color: var(--text, #1f1f2b); border: 1px solid var(--border, #ddd); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.9rem; margin-left: 6px;">Logs</button>
        </td>
      `;
      tbody.appendChild(tr);

      // Logs row (hidden by default) - expanded to show run outputs
      const logRow = document.createElement('tr');
      logRow.id = `log-row-${job.id}`;
      logRow.style.cssText = 'display: none; background: var(--surface-2, #f8f8ff);';
      // Note: colspan now 7 columns
      logRow.innerHTML = `
        <td colspan="7" style="padding: 12px;">
          <div style="max-height: 300px; overflow-y: auto; background: #1e1e1e; color: #d4d4d4; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 0.85rem;">
            <pre id="log-content-${job.id}" style="margin: 0;">Loading logs...</pre>
          </div>
        </td>
      `;
      tbody.appendChild(logRow);
    });
    table.appendChild(tbody);
    this.container.appendChild(table);

    // Attach event listeners
    this.attachListeners();
  }

  /**
   * Format duration in milliseconds to a human readable string
   */
  formatDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    const seconds = (ms / 1000).toFixed(1);
    return seconds + 's';
  }

  /**
   * Attach event listeners for Run Now and Show Logs buttons
   */
  attachListeners() {
    // Run Now buttons
    this.container.querySelectorAll('.run-now-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const jobId = e.target.dataset.jobId;
        if (!confirm(`Run cron job "${jobId}" now?`)) return;
        try {
          const res = await fetch(`/api/cron/jobs/${jobId}/run`, { method: 'POST' });
          if (!res.ok) throw new Error(`Request failed: ${res.statusText}`);
          const data = await res.json();
          alert(`Job started: ${data.message}${data.runId ? ' (Run ID: ' + data.runId + ')' : ''}`);
          // Refresh after a short delay to show updated status
          setTimeout(() => this.load(), 2000);
        } catch (err) {
          console.error('[CronView] Run error:', err);
          alert(`Failed to start job: ${err.message}`);
        }
      });
    });

    // Show Logs buttons
    this.container.querySelectorAll('.show-logs-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const jobId = e.target.dataset.jobId;
        const logRow = document.getElementById(`log-row-${jobId}`);
        const logContent = document.getElementById(`log-content-${jobId}`);

        if (logRow.style.display === 'none' || logRow.style.display === '') {
          // Show and load logs
          logRow.style.display = 'table-row';
          logContent.textContent = 'Loading...';
          try {
            const res = await fetch(`/api/cron/jobs/${jobId}/runs`);
            if (!res.ok) throw new Error('Failed to fetch logs');
            const data = await res.json();
            if (data.runs && data.runs.length > 0) {
              // Format runs: each run as a block with summary header and output
              const blocks = data.runs.map(run => {
                const started = run.started_at ? new Date(run.started_at).toLocaleString() : 'Unknown';
                const status = run.status || 'unknown';
                const exitCode = run.exit_code !== null && run.exit_code !== undefined ? run.exit_code : 'N/A';
                const duration = run.duration_ms ? this.formatDuration(run.duration_ms) : 'N/A';
                const output = run.output || '';
                return `--- Run: ${started} (status: ${status}, exit: ${exitCode}, duration: ${duration}) ---\n${output}`;
              });
              logContent.textContent = blocks.join('\n\n');
            } else {
              logContent.textContent = 'No run records found.';
            }
          } catch (err) {
            logContent.textContent = `Error loading logs: ${err.message}`;
          }
          // Toggle button text
          e.target.textContent = 'Hide Logs';
        } else {
          // Hide
          logRow.style.display = 'none';
          e.target.textContent = 'Show Logs';
        }
      });
    });
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }
}

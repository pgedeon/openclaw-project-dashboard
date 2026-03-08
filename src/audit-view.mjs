/**
 * Audit View for OpenClaw Dashboard
 *
 * Displays audit log of changes from /api/audit endpoint.
 * Shows who changed what and when, with before/after values.
 */

class AuditView {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      limit: 50,
      ...options
    };
    this.auditData = [];
    this.filters = {
      q: '',
      actor: '',
      action: '',
      start_date: '',
      end_date: '',
      limit: this.options.limit,
      offset: 0
    };
    this.total = 0;
    this.showChangesOnly = false;
    this._searchDebounce = null;
  }

  /**
   * Load audit data from server
   */
  async load(filters = {}) {
    const nextFilters = { ...this.filters, ...filters };
    nextFilters.limit = Number(nextFilters.limit) || this.options.limit;
    nextFilters.offset = Math.max(0, Number(nextFilters.offset) || 0);
    this.filters = nextFilters;

    const params = new URLSearchParams();
    if (this.filters.q) params.append('q', this.filters.q);
    if (this.filters.actor) params.append('actor', this.filters.actor);
    if (this.filters.action) params.append('action', this.filters.action);
    if (this.filters.start_date) params.append('start_date', this.filters.start_date);
    if (this.filters.end_date) params.append('end_date', this.filters.end_date);
    params.append('limit', this.filters.limit);
    params.append('offset', this.filters.offset);

    const response = await fetch(`/api/audit?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to load audit log: ${response.statusText}`);
    }
    const data = await response.json();
    const logs = Array.isArray(data) ? data : data.logs || data.rows || [];
    const total = data.total ?? logs.length;

    this.auditData = logs;
    this.total = Number(total) || 0;
    this.render();
  }

  /**
   * Render the audit view
   */
  render() {
    this.container.innerHTML = '';
    this.container.className = 'audit-view';

    const controls = this.renderControls();
    this.container.appendChild(controls);

    const displayData = this.showChangesOnly
      ? this.auditData.filter(record => record.old_value != null || record.new_value != null)
      : this.auditData;

    if (!displayData || displayData.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<p>No audit records found.</p>';
      this.container.appendChild(empty);
      return;
    }

    const table = this.renderTable(displayData);
    this.container.appendChild(table);
  }

  renderControls() {
    const controls = document.createElement('div');
    controls.className = 'audit-controls';
    controls.style.cssText = 'display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 16px;';

    const fieldWrap = (labelText, field) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px; font-size: 0.85rem; color: var(--muted, #666); min-width: 160px;';
      wrap.textContent = labelText;
      wrap.appendChild(field);
      return wrap;
    };

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search audit log';
    searchInput.value = this.filters.q || '';
    searchInput.style.cssText = 'padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border, #ddd); background: var(--surface, #fff);';
    searchInput.addEventListener('input', () => {
      clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => {
        this.load({ q: searchInput.value.trim(), offset: 0 });
      }, 300);
    });

    const actorSelect = document.createElement('select');
    actorSelect.style.cssText = 'padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border, #ddd); background: var(--surface, #fff);';
    this.populateSelect(actorSelect, this.getDistinctValues('actor'), this.filters.actor, 'All actors');
    actorSelect.addEventListener('change', () => this.load({ actor: actorSelect.value, offset: 0 }));

    const actionSelect = document.createElement('select');
    actionSelect.style.cssText = 'padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border, #ddd); background: var(--surface, #fff);';
    this.populateSelect(actionSelect, this.getDistinctValues('action'), this.filters.action, 'All actions');
    actionSelect.addEventListener('change', () => this.load({ action: actionSelect.value, offset: 0 }));

    const startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.value = this.filters.start_date || '';
    startInput.style.cssText = 'padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border, #ddd); background: var(--surface, #fff);';
    startInput.addEventListener('change', () => this.load({ start_date: startInput.value, offset: 0 }));

    const endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.value = this.filters.end_date || '';
    endInput.style.cssText = 'padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border, #ddd); background: var(--surface, #fff);';
    endInput.addEventListener('change', () => this.load({ end_date: endInput.value, offset: 0 }));

    const changesWrap = document.createElement('label');
    changesWrap.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--muted, #666); padding: 6px 8px; border: 1px solid var(--border, #ddd); border-radius: 6px; background: var(--surface, #fff);';
    const changesToggle = document.createElement('input');
    changesToggle.type = 'checkbox';
    changesToggle.checked = this.showChangesOnly;
    changesToggle.addEventListener('change', () => {
      this.showChangesOnly = changesToggle.checked;
      this.render();
    });
    const changesText = document.createElement('span');
    changesText.textContent = 'Show changes only';
    changesWrap.append(changesToggle, changesText);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset';
    resetBtn.style.cssText = 'padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border, #ddd); background: var(--surface, #fff); cursor: pointer;';
    resetBtn.addEventListener('click', () => {
      this.showChangesOnly = false;
      this.load({
        q: '',
        actor: '',
        action: '',
        start_date: '',
        end_date: '',
        offset: 0,
        limit: this.options.limit
      });
    });

    const pagination = this.renderPaginationControls();

    controls.append(
      fieldWrap('Search', searchInput),
      fieldWrap('Actor', actorSelect),
      fieldWrap('Action', actionSelect),
      fieldWrap('Start date', startInput),
      fieldWrap('End date', endInput),
      changesWrap,
      pagination,
      resetBtn
    );

    return controls;
  }

  renderPaginationControls() {
    const pagination = document.createElement('div');
    pagination.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;';

    const limitSelect = document.createElement('select');
    limitSelect.style.cssText = 'padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border, #ddd); background: var(--surface, #fff);';
    [25, 50, 100, 200].forEach(value => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value}/page`;
      limitSelect.appendChild(option);
    });
    limitSelect.value = String(this.filters.limit || this.options.limit);
    limitSelect.addEventListener('change', () => this.load({ limit: Number(limitSelect.value), offset: 0 }));

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = 'Prev';
    prevBtn.style.cssText = 'padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border, #ddd); background: var(--surface, #fff); cursor: pointer;';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = 'Next';
    nextBtn.style.cssText = 'padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border, #ddd); background: var(--surface, #fff); cursor: pointer;';

    const pageInfo = document.createElement('div');
    pageInfo.style.cssText = 'font-size: 0.85rem; color: var(--muted, #666);';
    pageInfo.textContent = this.getPageInfo();

    const offset = Number(this.filters.offset) || 0;
    const limit = Number(this.filters.limit) || this.options.limit;
    prevBtn.disabled = offset <= 0;
    nextBtn.disabled = offset + limit >= this.total;

    prevBtn.addEventListener('click', () => {
      const nextOffset = Math.max(0, offset - limit);
      this.load({ offset: nextOffset });
    });

    nextBtn.addEventListener('click', () => {
      const nextOffset = offset + limit;
      this.load({ offset: nextOffset });
    });

    pagination.append(limitSelect, prevBtn, nextBtn, pageInfo);
    return pagination;
  }

  renderTable(records) {
    const table = document.createElement('table');
    table.className = 'audit-table';
    table.style.cssText = 'width: 100%; border-collapse: collapse; background: var(--surface, white); border-radius: 8px; overflow: hidden;';

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr style="background: var(--surface-2, #f0f0f0); text-align: left;">
        <th style="padding: 10px; border-bottom: 1px solid var(--border, #ddd);">Timestamp</th>
        <th style="padding: 10px; border-bottom: 1px solid var(--border, #ddd);">Actor</th>
        <th style="padding: 10px; border-bottom: 1px solid var(--border, #ddd);">Action</th>
        <th style="padding: 10px; border-bottom: 1px solid var(--border, #ddd);">Task</th>
        <th style="padding: 10px; border-bottom: 1px solid var(--border, #ddd);">Details</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    records.forEach(record => {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom: 1px solid var(--border, #eee);';

      const taskId = record.task_id || '';
      const taskUrl = taskId ? `/api/tasks/${encodeURIComponent(taskId)}` : '';
      const taskCell = taskUrl
        ? `<a href="${taskUrl}" target="_blank" rel="noopener" style="font-family: monospace;">${this.escapeHtml(taskId)}</a>`
        : '<span style="color: var(--muted, #999);">&mdash;</span>';

      tr.innerHTML = `
        <td style="padding: 10px; font-size: 0.85rem; color: var(--muted, #666);">${new Date(record.timestamp).toLocaleString()}</td>
        <td style="padding: 10px;">${this.escapeHtml(record.actor || 'system')}</td>
        <td style="padding: 10px; text-transform: capitalize;">${this.escapeHtml(record.action || '')}</td>
        <td style="padding: 10px;">${taskCell}</td>
        <td style="padding: 10px;">${this.formatDetails(record)}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    return table;
  }

  getDistinctValues(field) {
    const values = new Set();
    this.auditData.forEach(record => {
      const value = record?.[field];
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => String(a).localeCompare(String(b)));
  }

  populateSelect(select, values, currentValue, placeholder) {
    select.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = placeholder;
    select.appendChild(emptyOption);

    const normalizedValues = values.slice();
    if (currentValue && !normalizedValues.includes(currentValue)) {
      normalizedValues.unshift(currentValue);
    }

    normalizedValues.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });

    select.value = currentValue || '';
  }

  getPageInfo() {
    const offset = Number(this.filters.offset) || 0;
    const limit = Number(this.filters.limit) || this.options.limit;
    const total = this.total || 0;
    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + limit, total);
    const pages = total === 0 ? 1 : Math.ceil(total / limit);
    const page = total === 0 ? 1 : Math.floor(offset / limit) + 1;
    const suffix = this.showChangesOnly ? ' (changes only)' : '';
    return `Showing ${start}-${end} of ${total} | Page ${page}/${pages}${suffix}`;
  }

  /**
   * Format details cell (show old/new if small)
   */
  formatDetails(record) {
    const { old_value, new_value } = record;
    if (!old_value && !new_value) return '<span style="color: var(--muted, #999);">&mdash;</span>';

    // Try to display a concise diff
    const parts = [];
    if (old_value) {
      const oldStr = this.stringifyValue(old_value);
      if (oldStr.length < 50) parts.push(`<span style="color: #ef4444;">- ${this.escapeHtml(oldStr)}</span>`);
    }
    if (new_value) {
      const newStr = this.stringifyValue(new_value);
      if (newStr.length < 50) parts.push(`<span style="color: #20b26c;">+ ${this.escapeHtml(newStr)}</span>`);
    }
    if (parts.length === 0) {
      // Fallback: show a summary
      const keys = [];
      if (typeof old_value === 'object' && old_value) keys.push(...Object.keys(old_value));
      if (typeof new_value === 'object' && new_value) keys.push(...Object.keys(new_value));
      const uniqueKeys = [...new Set(keys)].slice(0, 3);
      return `<span style="color: var(--muted, #666);">Changed: ${uniqueKeys.join(', ')}</span>`;
    }
    return parts.join(' ');
  }

  /**
   * Convert value to string
   */
  stringifyValue(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
      // Show JSON summary without spaces
      try {
        return JSON.stringify(value);
      } catch (e) {
        return '[object]';
      }
    }
    return String(value);
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Destroy view
   */
  destroy() {
    clearTimeout(this._searchDebounce);
    this.container.innerHTML = '';
    this.auditData = null;
  }
}

// Export
export { AuditView };
export default AuditView;

/**
 * Board View (Kanban) for OpenClaw Dashboard
 *
 * Displays tasks in columns by status with drag-and-drop support.
 * Integrates with the state manager and syncs status changes via PATCH.
 */

class BoardView {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      columnOrder: ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'completed'],
      ...options
    };
    this.projectId = null;
    this.boardData = null; // { project, workflow, columns: { status: [tasks] } }
    this.draggedTask = null;
    this.dragSourceElement = null;
  }

  /**
   * Set the project ID and load board data from the server
   */
  async setProjectId(projectId) {
    this.projectId = projectId;
    await this.loadBoardData();
  }

  /**
   * Load board data from /api/views/board?project_id=X
   */
  async loadBoardData() {
    if (!this.projectId) {
      throw new Error('Project ID not set');
    }
    const response = await fetch(`/api/views/board?project_id=${encodeURIComponent(this.projectId)}&include_child_projects=true`);
    if (!response.ok) {
      throw new Error(`Failed to load board: ${response.statusText}`);
    }
    this.boardData = await response.json();
    this.render();
  }

  /**
   * Render the full board
   */
  render() {
    this.container.innerHTML = '';
    this.container.className = 'board-view';

    if (!this.boardData) {
      this.container.innerHTML = '<div class="empty-state">No board data loaded</div>';
      return;
    }

    const { columns, workflow, project } = this.boardData;
    const orderedStatuses = this.options.columnOrder.filter(status => columns[status]);

    // Create column wrapper
    const boardElement = document.createElement('div');
    boardElement.className = 'board-board';
    boardElement.style.cssText = 'display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px;';

    orderedStatuses.forEach(status => {
      const column = this.createColumn(status, columns[status]);
      boardElement.appendChild(column);
    });

    this.container.appendChild(boardElement);
  }

  /**
   * Create a column element
   */
  createColumn(status, tasks) {
    const column = document.createElement('div');
    column.className = 'board-column';
    column.dataset.status = status;
    column.style.cssText = 'flex: 0 0 280px; background: var(--surface-2, #f0f0f0); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; border: 1px solid var(--border, #ddd);';

    // Column header
    const header = document.createElement('div');
    header.className = 'column-header';
    header.style.cssText = 'font-weight: 600; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;';
    const title = document.createElement('span');
    title.textContent = status.replace(/_/g, ' ');
    title.style.cssText = 'text-transform: capitalize;';
    const count = document.createElement('span');
    count.textContent = tasks.length;
    count.className = 'column-count';
    count.style.cssText = 'background: var(--muted, #999); color: white; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem;';
    header.appendChild(title);
    header.appendChild(count);
    column.appendChild(header);

    // Task list
    const list = document.createElement('div');
    list.className = 'column-tasks';
    list.dataset.status = status;
    list.style.cssText = 'flex: 1; min-height: 40px; display: flex; flex-direction: column; gap: 8px;';
    // Drag events
    list.addEventListener('dragover', e => e.preventDefault());
    list.addEventListener('drop', e => this.handleDrop(e, status));

    tasks.forEach(task => {
      const card = this.createTaskCard(task);
      list.appendChild(card);
    });

    column.appendChild(list);
    return column;
  }

  /**
   * Create a task card element
   */
  createTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.draggable = true;
    card.dataset.taskId = task.id;
    card.style.cssText = 'background: var(--surface, white); border-radius: 8px; padding: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); cursor: grab; border: 1px solid var(--border, #ddd);';

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title;
    title.style.cssText = 'font-weight: 500; margin-bottom: 6px; word-break: break-word;';

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    meta.style.cssText = 'font-size: 0.75rem; color: var(--muted, #666); display: flex; gap: 8px; flex-wrap: wrap;';

    if (task.priority) {
      const priority = document.createElement('span');
      priority.textContent = task.priority;
      priority.style.cssText = `text-transform: uppercase; font-weight: 600; color: ${this.getPriorityColor(task.priority)};`;
      meta.appendChild(priority);
    }
    if (task.due_date) {
      const due = document.createElement('span');
      due.textContent = new Date(task.due_date).toLocaleDateString();
      meta.appendChild(due);
    }
    if (this.boardData?.project?.aggregated && task.project_name && task.project_id !== this.projectId) {
      const source = document.createElement('span');
      source.textContent = task.project_name;
      source.style.cssText = 'background: rgba(92, 107, 242, 0.12); color: var(--text, #111827); padding: 2px 6px; border-radius: 999px; font-weight: 600;';
      meta.appendChild(source);
    }

    card.appendChild(title);
    card.appendChild(meta);

    // Drag start
    card.addEventListener('dragstart', e => {
      this.draggedTask = task;
      this.dragSourceElement = card;
      e.dataTransfer.setData('text/plain', task.id);
      card.style.opacity = '0.5';
    });

    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
      this.draggedTask = null;
      this.dragSourceElement = null;
    });

    return card;
  }

  /**
   * Handle drop on a column
   */
  async handleDrop(event, newStatus) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain');
    if (!taskId || !this.draggedTask) return;

    // Optimistically move in UI
    const sourceCol = event.target.closest('.column-tasks');
    if (sourceCol && sourceCol.dataset.status === newStatus) return; // Same column

    // Update boardData locally
    const oldStatus = this.draggedTask.status;
    if (this.boardData.columns[oldStatus]) {
      this.boardData.columns[oldStatus] = this.boardData.columns[oldStatus].filter(t => t.id !== taskId);
    }
    if (!this.boardData.columns[newStatus]) this.boardData.columns[newStatus] = [];
    this.draggedTask.status = newStatus;
    this.boardData.columns[newStatus].push(this.draggedTask);

    // Re-render columns (or just move card for smoothness; full re-render for simplicity)
    this.render();

    // Persist change via state manager updateTask (which syncs via PATCH)
    try {
      // Use global updateTask if available, else fallback to direct fetch
      if (window.updateTask) {
        await window.updateTask(taskId, { status: newStatus });
      } else {
        // Fallback: direct PATCH to API
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        if (!response.ok) throw new Error('PATCH failed');
      }
      console.log(`[BoardView] Task ${taskId} moved to ${newStatus}`);
    } catch (error) {
      console.error('[BoardView] Failed to update task status:', error);
      // Revert UI on error? Could reload board data
      alert('Failed to update task status. Refreshing board...');
      await this.loadBoardData();
    }
  }

  /**
   * Get priority color
   */
  getPriorityColor(priority) {
    switch (priority) {
      case 'critical': return '#dc2626';
      case 'high': return '#ea580c';
      case 'medium': return '#d97706';
      case 'low': return '#16a34a';
      default: return '#6b7280';
    }
  }

  /**
   * Destroy view and clean up
   */
  destroy() {
    this.container.innerHTML = '';
    this.boardData = null;
  }
}

// Export for module usage
export { BoardView };
export default BoardView;

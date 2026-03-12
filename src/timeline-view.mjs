/**
 * Lazy-Loading Timeline View for OpenClaw Dashboard
 * 
 * Renders tasks on a timeline with smart lazy loading:
 * - Only renders tasks within visible date range
 * - Loads more on scroll/zoom
 * - Groups tasks by date
 * - Virtualizes timeline if many events
 */

class TimelineView {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      dateFormat: 'MMM d, yyyy',
      groupByDay: true,
      maxVisibleGroups: 50, // Max groups to render at once
      bufferGroups: 5, // Extra groups to render outside viewport
      ...options
    };
    
    this.tasks = [];
    this.filteredTasks = [];
    this.visibleRange = { start: null, end: null };
    this.groupedTasks = new Map();
    this.timelineElement = null;
    this.viewportElement = null;
    this.scrollTop = 0;
    this.viewportHeight = 0;
    this.isInitialized = false;
    
    this.init();
  }

  /**
   * Initialize timeline view
   */
  init() {
    if (!this.container) {
      console.error('[TimelineView] Container not provided');
      return;
    }

    this.createTimelineStructure();
    this.bindEvents();
    this.isInitialized = true;
  }

  /**
   * Create the timeline DOM structure
   */
  createTimelineStructure() {
    this.container.innerHTML = '';
    this.container.className = 'timeline-view';
    this.container.style.display = 'flex';
    this.container.style.flexDirection = 'column';
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';

    // Viewport (scrollable area)
    this.viewportElement = document.createElement('div');
    this.viewportElement.className = 'timeline-viewport';
    this.viewportElement.style.cssText = `
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      position: relative;
      will-change: transform;
    `;
    this.container.appendChild(this.viewportElement);

    // Content wrapper
    this.timelineElement = document.createElement('div');
    this.timelineElement.className = 'timeline-content';
    this.timelineElement.style.cssText = `
      padding: 20px;
      min-height: 100%;
    `;
    this.viewportElement.appendChild(this.timelineElement);
  }

  /**
   * Bind scroll events for lazy loading
   */
  bindEvents() {
    this.viewportElement.addEventListener('scroll', this.onScroll.bind(this), { passive: true });
    window.addEventListener('resize', this.onResize.bind(this));
  }

  /**
   * Handle scroll events
   */
  onScroll() {
    this.scrollTop = this.viewportElement.scrollTop;
    this.checkVisibleRange();
    this.renderVisibleGroups();
  }

  /**
   * Handle resize events
   */
  onResize() {
    this.viewportHeight = this.viewportElement.clientHeight;
    this.checkVisibleRange();
    this.renderVisibleGroups();
  }

  /**
   * Set tasks to display
   * @param {Array} tasks - Array of task objects
   */
  setTasks(tasks) {
    this.tasks = tasks || [];
    this.filteredTasks = [...this.tasks];
    this.groupTasks();
    this.visibleRange = { start: null, end: null };
    this.render();
  }

  /**
   * Update filtered tasks (after search/filter)
   * @param {Array} tasks - Filtered task array
   */
  updateFiltered(tasks) {
    this.filteredTasks = tasks || [];
    this.groupTasks();
    this.visibleRange = { start: null, end: null };
    this.render();
  }

  /**
   * Group tasks by date
   */
  groupTasks() {
    this.groupedTasks.clear();
    
    if (this.options.groupByDay) {
      this.filteredTasks.forEach(task => {
        const date = this.getTaskDate(task);
        const key = this.formatDayKey(date);
        
        if (!this.groupedTasks.has(key)) {
          this.groupedTasks.set(key, {
            date: new Date(date),
            tasks: []
          });
        }
        this.groupedTasks.get(key).tasks.push(task);
      });
    } else {
      // Group by week or month could be added here
      this.filteredTasks.forEach(task => {
        const date = this.getTaskDate(task);
        const key = date.getTime();
        
        if (!this.groupedTasks.has(key)) {
          this.groupedTasks.set(key, {
            date: date,
            tasks: []
          });
        }
        this.groupedTasks.get(key).tasks.push(task);
      });
    }

    // Sort groups by date (most recent first for new-to-old view)
    const sortedGroups = Array.from(this.groupedTasks.entries())
      .sort((a, b) => b[1].date - a[1].date);
    
    this.groupedTasks = new Map(sortedGroups);
  }

  /**
   * Get the relevant date for a task
   * @param {Object} task - Task object
   * @returns {Date} Date to group by
   */
  getTaskDate(task) {
    // Try updatedAt, then createdAt, then current date
    const dateStr = task.updatedAt || task.createdAt || new Date().toISOString();
    return new Date(dateStr);
  }

  /**
   * Format day key for grouping
   * @param {Date} date - Date object
   * @returns {string} Day key (YYYY-MM-DD)
   */
  formatDayKey(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Check visible range of groups based on scroll
   */
  checkVisibleRange() {
    const groupArray = Array.from(this.groupedTasks.values());
    if (groupArray.length === 0) return;

    const groupHeight = this.getGroupHeight();
    const viewportHeight = this.viewportHeight;
    const scrollTop = this.scrollTop;

    const startIndex = Math.max(0, Math.floor(scrollTop / groupHeight) - this.options.bufferGroups);
    const visibleCount = Math.ceil(viewportHeight / groupHeight) + (this.options.bufferGroups * 2);
    const endIndex = Math.min(groupArray.length - 1, startIndex + visibleCount);

    this.visibleRange = { start: startIndex, end: endIndex };
    
    // Load more groups if near the end
    if (endIndex >= groupArray.length - 2 && this.filteredTasks.length > this.tasks.length) {
      // Could trigger loading more historical tasks if available
    }
  }

  /**
   * Get estimated height of a timeline group
   * @returns {number} Height in pixels
   */
  getGroupHeight() {
    // Approximate: date header + min 2 tasks + padding
    const headerHeight = 40;
    const taskHeight = 100;
    const padding = 20;
    return headerHeight + (2 * taskHeight) + padding;
  }

  /**
   * Render the full timeline (initial)
   */
  render() {
    // Show skeleton if many groups
    const groupCount = this.groupedTasks.size;
    
    if (groupCount > this.options.maxVisibleGroups) {
      this.renderLazy();
    } else {
      this.renderFull();
    }
  }

  /**
   * Render full timeline (all groups)
   */
  renderFull() {
    const groupArray = Array.from(this.groupedTasks.values());
    this.timelineElement.innerHTML = '';
    
    if (groupArray.length === 0) {
      this.showEmptyState();
      return;
    }

    const fragment = document.createDocumentFragment();
    
    groupArray.forEach((group, index) => {
      const groupEl = this.createTimelineGroup(group, index);
      fragment.appendChild(groupEl);
    });

    this.timelineElement.appendChild(fragment);
    this.viewportHeight = this.viewportElement.clientHeight;
    this.checkVisibleRange();
  }

  /**
   * Render lazy-loaded timeline (virtualized groups)
   */
  renderLazy() {
    const groupArray = Array.from(this.groupedTasks.values());
    this.timelineElement.innerHTML = '';
    
    if (groupArray.length === 0) {
      this.showEmptyState();
      return;
    }

    // Set total height
    const totalHeight = groupArray.length * this.getGroupHeight();
    this.timelineElement.style.height = `${totalHeight}px`;

    // Initial visible range
    this.viewportHeight = this.viewportElement.clientHeight;
    if (!this.visibleRange.start) {
      this.checkVisibleRange();
    }

    this.renderVisibleGroups();
  }

  /**
   * Render currently visible groups (for lazy loading)
   */
  renderVisibleGroups() {
    if (!this.visibleRange.start) return;

    const groupArray = Array.from(this.groupedTasks.values());
    const { start, end } = this.visibleRange;

    // Remove items outside new visible range
    const existingGroups = this.timelineElement.querySelectorAll('.timeline-group');
    existingGroups.forEach(el => {
      const index = parseInt(el.dataset.groupIndex, 10);
      if (index < start || index > end) {
        el.remove();
      }
    });

    // Add new visible groups
    for (let i = start; i <= end; i++) {
      if (i >= groupArray.length) break;
      
      const existing = this.timelineElement.querySelector(`[data-group-index="${i}"]`);
      if (!existing) {
        const groupEl = this.createTimelineGroup(groupArray[i], i);
        this.timelineElement.appendChild(groupEl);
      }
    }
  }

  /**
   * Create a timeline group element
   * @param {Object} group - Group data with date and tasks
   * @param {number} index - Group index
   * @returns {HTMLElement} Group element
   */
  createTimelineGroup(group, index) {
    const groupEl = document.createElement('div');
    groupEl.className = 'timeline-group';
    groupEl.dataset.groupIndex = index;
    groupEl.style.cssText = `
      position: ${this.isLazyActive() ? 'absolute' : 'relative'};
      top: ${this.isLazyActive() ? `${index * this.getGroupHeight()}px` : 'auto'};
      width: 100%;
      box-sizing: border-box;
      padding: 16px 0;
      border-bottom: 1px solid var(--border);
    `;

    // Date header
    const header = document.createElement('div');
    header.className = 'timeline-date-header';
    header.style.cssText = `
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
    `;
    header.textContent = group.date.toLocaleDateString(undefined, this.options.dateFormat);
    groupEl.appendChild(header);

    // Tasks for this group
    group.tasks.forEach(task => {
      const taskEl = this.createTimelineTask(task);
      groupEl.appendChild(taskEl);
    });

    return groupEl;
  }

  /**
   * Create a timeline task element
   * @param {Object} task - Task object
   * @returns {HTMLElement} Task element
   */
  createTimelineTask(task) {
    const taskEl = document.createElement('div');
    taskEl.className = `timeline-task ${task.completed ? 'completed' : ''}`;
    taskEl.style.cssText = `
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 12px;
      padding: 12px;
      margin-bottom: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: var(--shadow-soft);
      align-items: center;
      transition: transform 0.2s ease, border-color 0.2s ease;
    `;

    // Category indicator (colored dot)
    const indicator = document.createElement('div');
    indicator.style.cssText = `
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--accent);
      flex-shrink: 0;
    `;
    taskEl.appendChild(indicator);

    // Task text and meta
    const info = document.createElement('div');
    info.style.cssText = `
      min-width: 0;
    `;
    
    const text = document.createElement('div');
    text.className = 'timeline-task-text';
    text.style.cssText = `
      font-size: 0.95rem;
      font-weight: 500;
      color: var(--text);
      margin-bottom: 4px;
      word-break: break-word;
    `;
    text.textContent = task.text;

    const meta = document.createElement('div');
    meta.className = 'timeline-task-meta';
    meta.style.cssText = `
      font-size: 0.8rem;
      color: var(--muted);
      display: flex;
      gap: 8px;
    `;
    
    const category = document.createElement('span');
    category.className = 'category-badge';
    category.textContent = task.category || 'General';
    category.style.cssText = `
      background: rgba(92, 107, 242, 0.12);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: 999px;
      font-weight: 600;
      font-size: 0.75rem;
    `;
    
    meta.appendChild(category);
    info.appendChild(text);
    info.appendChild(meta);
    taskEl.appendChild(info);

    // Status indicator
    const status = document.createElement('div');
    status.style.cssText = `
      font-size: 0.8rem;
      color: ${task.completed ? 'var(--success)' : 'var(--accent)'};
      font-weight: 600;
    `;
    status.textContent = task.completed ? '✓ Done' : 'Pending';
    taskEl.appendChild(status);

    // Hover effect
    taskEl.addEventListener('mouseenter', () => {
      taskEl.style.transform = 'translateX(4px)';
      taskEl.style.borderColor = 'var(--accent)';
    });
    taskEl.addEventListener('mouseleave', () => {
      taskEl.style.transform = '';
      taskEl.style.borderColor = '';
    });

    return taskEl;
  }

  /**
   * Check if lazy loading is active
   * @returns {boolean}
   */
  isLazyActive() {
    return this.groupedTasks.size > this.options.maxVisibleGroups;
  }

  /**
   * Show empty state
   */
  showEmptyState() {
    this.timelineElement.innerHTML = `
      <div class="empty-state" style="
        text-align: center;
        padding: 60px 20px;
        color: var(--muted);
        background: var(--surface);
        border-radius: 16px;
        box-shadow: var(--shadow-soft);
      ">
        <p>No tasks match the current filters.</p>
      </div>
    `;
  }

  /**
   * Scroll to a specific date
   * @param {string|Date} date - Date to scroll to
   */
  scrollToDate(date) {
    const targetDate = new Date(date);
    const dayKey = this.formatDayKey(targetDate);
    
    let groupIndex = 0;
    for (const [key, group] of this.groupedTasks) {
      if (key === dayKey) {
        this.viewportElement.scrollTo({
          top: groupIndex * this.getGroupHeight(),
          behavior: 'smooth'
        });
        return;
      }
      groupIndex++;
    }
  }

  /**
   * Destroy timeline view and clean up
   */
  destroy() {
    this.viewportElement?.removeEventListener('scroll', this.onScroll);
    window?.removeEventListener('resize', this.onResize);
    this.container.innerHTML = '';
    this.groupedTasks.clear();
    this.isInitialized = false;
  }
}

export { TimelineView };
export default TimelineView;

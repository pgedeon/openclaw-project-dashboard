/**
 * Dashboard Integration Module - Optimized for Performance
 * 
 * Connects the HTML UI with the StateManager and OfflineUIManager.
 * Implements:
 * - Virtual scrolling for large datasets (>100 tasks)
 * - Web Worker for filtering/sorting operations
 * - DOM element recycling
 * - Loading skeletons during async operations
 * - Performance monitoring
 * - Debounced search and events
 */

import { 
  init as initState, 
  getState, 
  setState, 
  updateState,
  addTask, 
  toggleTask, 
  updateTask, 
  deleteTask, 
  archiveTask,
  restoreTask,
  clearCompleted,
  subscribe,
  // Saved Views
  setSavedViews,
  setActiveView,
  addSavedView,
  updateSavedView,
  removeSavedView
} from './offline/state-manager.mjs';

import { offlineUI } from './offline/offline-ui.mjs';

// Performance monitoring
import { performanceMonitor } from './performance-monitor.mjs';

// Skeleton loader
import { skeletonLoader } from './skeleton-loader.mjs';

import { AuditView } from './audit-view.mjs';

// Virtual scroller (only used when needed)
let VirtualScroller = null;

// Timeline view (lazy loading)
let TimelineView = null;

// Board view (lazy loading)
let BoardView = null;

// Cron view (lazy loading)
let cronViewInstance = null;

// Board view instance
let boardViewInstance = null;

// Agent view (lazy loading)
let AgentViewClass = null;

// Agent view instance
let agentViewInstance = null;

// Audit view instance
let auditViewInstance = null;

// Incremental Sync
let incrementalSyncInterval = null;
const INCREMENTAL_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Web Worker for expensive operations
let dashboardWorker = null;
let workerAvailable = false;

// DOM references
const dom = {
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.getElementById('themeIcon'),
  themeLabel: document.getElementById('themeLabel'),
  taskInput: document.getElementById('taskInput'),
  categoryInput: document.getElementById('categoryInput'),
  taskDescriptionInput: document.getElementById('taskDescriptionInput'),
  taskOwnerInput: document.getElementById('taskOwnerInput'),
  taskModelInput: document.getElementById('taskModelInput'),
  taskStatusInput: document.getElementById('taskStatusInput'),
  taskPriorityInput: document.getElementById('taskPriorityInput'),
  taskStartDateInput: document.getElementById('taskStartDateInput'),
  taskDueDateInput: document.getElementById('taskDueDateInput'),
  taskRecurrenceInput: document.getElementById('taskRecurrenceInput'),
  addTaskBtn: document.getElementById('addTaskBtn'),
  notice: document.getElementById('notice'),
  totalTasks: document.getElementById('totalTasks'),
  completedTasks: document.getElementById('completedTasks'),
  pendingTasks: document.getElementById('pendingTasks'),
  archivedTasks: document.getElementById('archivedTasks'),
  filterAllCount: document.getElementById('filterAllCount'),
  filterPendingCount: document.getElementById('filterPendingCount'),
  filterCompletedCount: document.getElementById('filterCompletedCount'),
  filterArchivedCount: document.getElementById('filterArchivedCount'),
  filterButtons: document.querySelectorAll('.filter-btn'),
  searchInput: document.getElementById('searchInput'),
  categoryFilter: document.getElementById('categoryFilter'),
  sortSelect: document.getElementById('sortSelect'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  clearCompletedBtn: document.getElementById('clearCompletedBtn'),
  projectSelect: document.getElementById('projectSelect'),
  projectContext: document.getElementById('projectContext'),
  projectBreadcrumb: document.getElementById('projectBreadcrumb'),
  projectCurrentName: document.getElementById('projectCurrentName'),
  projectKindBadge: document.getElementById('projectKindBadge'),
  projectSummary: document.getElementById('projectSummary'),
  projectMetrics: document.getElementById('projectMetrics'),
  projectNavigatorSummary: document.getElementById('projectNavigatorSummary'),
  projectJumpLinks: document.getElementById('projectJumpLinks'),
  projectAddRootBtn: document.getElementById('projectAddRootBtn'),
  projectAddChildBtn: document.getElementById('projectAddChildBtn'),
  projectEditBtn: document.getElementById('projectEditBtn'),
  projectArchiveBtn: document.getElementById('projectArchiveBtn'),
  projectFormPanel: document.getElementById('projectFormPanel'),
  projectFormTitle: document.getElementById('projectFormTitle'),
  projectFormSubtitle: document.getElementById('projectFormSubtitle'),
  projectFormMode: document.getElementById('projectFormMode'),
  projectFormProjectId: document.getElementById('projectFormProjectId'),
  projectNameInput: document.getElementById('projectNameInput'),
  projectDescriptionInput: document.getElementById('projectDescriptionInput'),
  projectParentSelect: document.getElementById('projectParentSelect'),
  projectStatusInput: document.getElementById('projectStatusInput'),
  projectCancelBtn: document.getElementById('projectCancelBtn'),
  projectSaveBtn: document.getElementById('projectSaveBtn'),
  taskList: document.getElementById('taskList'),
  emptyState: document.getElementById('emptyState'),
  emptyMessage: document.getElementById('emptyMessage'),
  categoryOptions: document.getElementById('categoryOptions'),
  agentSelect: null,
  agentStatsContainer: null,
  helpModal: document.getElementById('helpModal'),
  helpClose: document.getElementById('helpClose'),
  perfPanel: document.getElementById('perfPanel'),
  perfMetrics: document.getElementById('perfMetrics'),
  perfClose: document.getElementById('perfClose'),
  savedViewSelect: document.getElementById('savedViewSelect'),
  saveViewBtn: document.getElementById('saveViewBtn'),
  deleteViewBtn: document.getElementById('deleteViewBtn')
};

// State
let editingId = null;
let editingText = '';
let editingCategory = '';
let editingStatus = '';
let editingPriority = '';
let editingOwner = '';
let editingDueDate = '';
let editingStartDate = '';
let editingDescription = '';
let editingEstimatedEffort = null;
let editingActualEffort = null;
let editingRecurrence = null;
let editingModel = '';
let noticeTimer = null;
let currentView = 'list';
let virtualScroller = null;
let isVirtualScrolling = false;
let taskPool = []; // DOM element pool for recycling
let searchDebounceTimer = null;
let isInitialized = false;
let currentAgent = null;
let agentTasks = [];
let agentRefreshInterval = null;
let agentPaused = false;
let expandedTaskIds = new Set(); // Set of task IDs with expanded children
let latestStateSnapshot = { tasks: [], categories: [], savedViews: [], project_id: null };
let activeTaskLoadRequest = 0;
let cachedTaskOptions = null;
let taskComposerModelDirty = false;
let projectCatalog = [];
let projectCatalogById = new Map();

// Performance tracking
let renderStartTime = 0;
let perfInterval = null;
// Help modal focus management
let helpPrevFocusElement = null;

const PROJECT_SELECTOR_PAGE_SIZE = 200;
const FALLBACK_DEFAULT_MODEL = 'openrouter1/stepfun/step-3.5-flash:free';

function formatTokenLabel(value) {
  return String(value || '')
    .replace(/[:/_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function normalizeProject(project) {
  if (!project || !project.id) return null;
  const metadata = project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
    ? project.metadata
    : {};
  return {
    ...project,
    metadata,
    depth: Number(project.depth || 0),
    child_count: Number(project.child_count || 0),
    descendant_count: Number(project.descendant_count || 0),
    task_count: Number(project.task_count || 0),
    active_task_count: Number(project.active_task_count || 0),
    blocked_count: Number(project.blocked_count || 0),
    overdue_count: Number(project.overdue_count || 0),
    rollup_task_count: Number(project.rollup_task_count ?? project.task_count ?? 0),
    rollup_active_task_count: Number(project.rollup_active_task_count ?? project.active_task_count ?? 0),
    rollup_blocked_count: Number(project.rollup_blocked_count ?? project.blocked_count ?? 0),
    rollup_overdue_count: Number(project.rollup_overdue_count ?? project.overdue_count ?? 0)
  };
}

function setProjectCatalog(projects = []) {
  const normalized = projects.map(normalizeProject).filter(Boolean);
  projectCatalog = normalized;
  projectCatalogById = new Map(normalized.map((project) => [project.id, project]));
}

function mergeProjectIntoCatalog(project) {
  const normalized = normalizeProject(project);
  if (!normalized) return null;

  const existingIndex = projectCatalog.findIndex((item) => item.id === normalized.id);
  if (existingIndex >= 0) {
    projectCatalog.splice(existingIndex, 1, normalized);
  } else {
    projectCatalog = [normalized, ...projectCatalog];
  }
  projectCatalogById.set(normalized.id, normalized);
  return normalized;
}

function getProjectFromCatalog(projectId) {
  if (!projectId) return null;
  return projectCatalogById.get(projectId) || null;
}

function projectHasChildren(project) {
  return Number(project?.child_count || 0) > 0;
}

function getProjectVisibleTaskCount(project) {
  return projectHasChildren(project)
    ? Number(project?.rollup_task_count ?? 0)
    : Number(project?.task_count ?? 0);
}

function getProjectVisibleBlockedCount(project) {
  return projectHasChildren(project)
    ? Number(project?.rollup_blocked_count ?? 0)
    : Number(project?.blocked_count ?? 0);
}

function getProjectVisibleOverdueCount(project) {
  return projectHasChildren(project)
    ? Number(project?.rollup_overdue_count ?? 0)
    : Number(project?.overdue_count ?? 0);
}

function getProjectVisibleActiveCount(project) {
  return projectHasChildren(project)
    ? Number(project?.rollup_active_task_count ?? 0)
    : Number(project?.active_task_count ?? 0);
}

function getProjectDescendantIds(projectId) {
  if (!projectId) return [];
  return projectCatalog
    .filter((project) => Array.isArray(project.project_path_ids) && project.project_path_ids.includes(projectId) && project.id !== projectId)
    .map((project) => project.id);
}

function getProjectContextLinks(project) {
  if (!project) return [];

  if (projectHasChildren(project)) {
    return projectCatalog.filter((item) => item.parent_project_id === project.id);
  }

  if (project.parent_project_id) {
    return projectCatalog.filter((item) => item.parent_project_id === project.parent_project_id);
  }

  return projectCatalog.filter((item) => item.parent_project_id === project.id);
}

function getProjectRoot(project) {
  if (!project) return null;
  const rootId = Array.isArray(project.project_path_ids) && project.project_path_ids.length > 0
    ? project.project_path_ids[0]
    : project.id;
  return getProjectFromCatalog(rootId) || project;
}

function buildProjectChildrenMap() {
  const map = new Map();
  projectCatalog.forEach((project) => {
    const key = project.parent_project_id || '__root__';
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(project);
  });
  return map;
}

function getTaskOpenClawMetadata(task) {
  const metadata = task?.metadata;
  if (metadata && typeof metadata === 'object' && metadata.openclaw && typeof metadata.openclaw === 'object') {
    return metadata.openclaw;
  }
  return metadata && typeof metadata === 'object' ? metadata : {};
}

function getTaskPreferredModel(task) {
  const openclawMeta = getTaskOpenClawMetadata(task);
  if (typeof openclawMeta.preferred_model === 'string' && openclawMeta.preferred_model.trim()) {
    return openclawMeta.preferred_model.trim();
  }
  if (typeof openclawMeta.model === 'string' && openclawMeta.model.trim()) {
    return openclawMeta.model.trim();
  }
  return '';
}

function buildTaskMetadata(existingMetadata = {}, { preferredModel = '' } = {}) {
  const metadata = existingMetadata && typeof existingMetadata === 'object'
    ? { ...existingMetadata }
    : {};
  const openclawMeta = metadata.openclaw && typeof metadata.openclaw === 'object'
    ? { ...metadata.openclaw }
    : {};

  if (preferredModel) {
    openclawMeta.preferred_model = preferredModel;
  } else {
    delete openclawMeta.preferred_model;
  }

  openclawMeta.created_via = 'dashboard';

  if (Object.keys(openclawMeta).length > 0) {
    metadata.openclaw = openclawMeta;
  } else {
    delete metadata.openclaw;
  }

  return metadata;
}

function getAgentCatalog() {
  return Array.isArray(cachedTaskOptions?.agents) ? cachedTaskOptions.agents : [];
}

function getModelCatalog() {
  return Array.isArray(cachedTaskOptions?.models) ? cachedTaskOptions.models : [];
}

function getAgentDisplayName(agentId) {
  if (!agentId) return 'Assign';
  const match = getAgentCatalog().find(agent => agent.id === agentId);
  return match?.name || agentId;
}

function getModelDisplayName(modelId) {
  if (!modelId) return '';
  const match = getModelCatalog().find(model => model.id === modelId);
  const rawDisplay = match?.displayName || match?.name || modelId;
  if (rawDisplay.includes('/')) {
    const provider = match?.provider || modelId.split('/')[0];
    const shortName = formatTokenLabel(rawDisplay.split('/').slice(-1)[0]);
    return provider ? `${shortName} · ${provider}` : shortName;
  }
  return rawDisplay;
}

function getModelChipLabel(modelId) {
  const displayName = getModelDisplayName(modelId);
  if (!displayName) return '';
  return displayName.length > 26 ? `${displayName.slice(0, 23)}...` : displayName;
}

function getTaskRuntimeSnapshot(task) {
  const openclawMeta = getTaskOpenClawMetadata(task);
  const runtime = openclawMeta.runtime && typeof openclawMeta.runtime === 'object'
    ? openclawMeta.runtime
    : {};

  const agent = typeof runtime.agent === 'string' && runtime.agent.trim()
    ? runtime.agent.trim()
    : (typeof task.execution_locked_by === 'string' ? task.execution_locked_by.trim() : '');
  const state = typeof runtime.state === 'string' && runtime.state.trim()
    ? runtime.state.trim()
    : (agent ? 'active' : '');
  const activity = typeof runtime.current_activity === 'string' && runtime.current_activity.trim()
    ? runtime.current_activity.trim()
    : '';
  const lastSeenAt = typeof runtime.last_seen_at === 'string' && runtime.last_seen_at.trim()
    ? runtime.last_seen_at.trim()
    : '';

  return { agent, state, activity, lastSeenAt };
}

function getTaskRuntimeChip(task) {
  const runtime = getTaskRuntimeSnapshot(task);
  if (!runtime.agent && !runtime.activity) return null;

  const actor = runtime.agent || 'OpenClaw';
  const detail = runtime.activity
    ? runtime.activity
    : (runtime.state ? formatTokenLabel(runtime.state) : 'Active');
  const label = `${actor} · ${detail}`;

  return {
    label: label.length > 60 ? `${label.slice(0, 57)}...` : label,
    title: runtime.lastSeenAt
      ? `${label}\nLast update ${formatDate(runtime.lastSeenAt)}`
      : label
  };
}

function replaceSelectOptions(selectEl, options, { placeholderLabel, selectedValue = '', getValue, getLabel }) {
  if (!selectEl) return;

  const currentValue = selectedValue || selectEl.value || '';
  selectEl.innerHTML = '';

  if (placeholderLabel) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = placeholderLabel;
    selectEl.appendChild(placeholder);
  }

  options.forEach((option) => {
    const itemValue = getValue(option);
    if (!itemValue) return;
    const el = document.createElement('option');
    el.value = itemValue;
    el.textContent = getLabel(option);
    if (itemValue === currentValue) {
      el.selected = true;
    }
    selectEl.appendChild(el);
  });

  if (currentValue && !Array.from(selectEl.options).some(option => option.value === currentValue)) {
    const fallback = document.createElement('option');
    fallback.value = currentValue;
    fallback.textContent = currentValue;
    fallback.selected = true;
    selectEl.appendChild(fallback);
  }
}

function populateTaskComposerOptions(taskOptions) {
  if (!taskOptions) return;

  replaceSelectOptions(dom.taskOwnerInput, taskOptions.agents || [], {
    placeholderLabel: 'Unassigned',
    selectedValue: dom.taskOwnerInput?.value || '',
    getValue: (agent) => agent.id,
    getLabel: (agent) => agent.name || agent.id
  });

  replaceSelectOptions(dom.taskModelInput, taskOptions.models || [], {
    placeholderLabel: 'No model preference',
    selectedValue: dom.taskModelInput?.value || taskOptions.defaults?.model || '',
    getValue: (model) => model.id,
    getLabel: (model) => getModelDisplayName(model.id)
  });

  if (!dom.taskModelInput?.value && taskOptions.defaults?.model) {
    dom.taskModelInput.value = taskOptions.defaults.model;
  }
}

async function fetchTaskOptions(force = false) {
  if (cachedTaskOptions && !force) {
    return cachedTaskOptions;
  }

  try {
    const response = await fetch('/api/task-options');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    cachedTaskOptions = {
      agents: Array.isArray(data.agents) ? data.agents : [],
      models: Array.isArray(data.models) ? data.models : [],
      defaults: data.defaults || {}
    };
    cachedAgents = cachedTaskOptions.agents.map(agent => agent.id);
  } catch (error) {
    console.warn('[Dashboard] Could not load task options:', error);
    cachedTaskOptions = {
      agents: [],
      models: [{ id: FALLBACK_DEFAULT_MODEL, displayName: 'Step-3.5 Flash Free' }],
      defaults: { agent: '', model: FALLBACK_DEFAULT_MODEL }
    };
    cachedAgents = [];
  }

  populateTaskComposerOptions(cachedTaskOptions);
  return cachedTaskOptions;
}

function resetTaskComposer() {
  taskComposerModelDirty = false;
  if (dom.taskInput) dom.taskInput.value = '';
  if (dom.categoryInput) dom.categoryInput.value = '';
  if (dom.taskDescriptionInput) dom.taskDescriptionInput.value = '';
  if (dom.taskOwnerInput) dom.taskOwnerInput.value = '';
  if (dom.taskStatusInput) dom.taskStatusInput.value = 'backlog';
  if (dom.taskPriorityInput) dom.taskPriorityInput.value = 'medium';
  if (dom.taskStartDateInput) dom.taskStartDateInput.value = '';
  if (dom.taskDueDateInput) dom.taskDueDateInput.value = '';
  if (dom.taskRecurrenceInput) dom.taskRecurrenceInput.value = 'none';
  if (dom.taskModelInput) {
    dom.taskModelInput.value = cachedTaskOptions?.defaults?.model || FALLBACK_DEFAULT_MODEL;
  }
}

function getTaskStatus(task) {
  if (!task) return 'backlog';
  if (task.archived || task.archived_at) return 'archived';
  if (typeof task.status === 'string' && task.status.trim()) {
    return task.status.trim();
  }
  return task.completed ? 'completed' : 'backlog';
}

function isTaskArchived(task) {
  return getTaskStatus(task) === 'archived' || Boolean(task?.archived) || Boolean(task?.archived_at);
}

function isTaskCompleted(task) {
  return getTaskStatus(task) === 'completed';
}

function isTaskPending(task) {
  return !isTaskArchived(task) && !isTaskCompleted(task);
}

function shouldAutoExpandHierarchy(state) {
  if (!state) return false;
  return Boolean(
    (state.filter && state.filter !== 'all') ||
    (state.search && state.search.trim()) ||
    (state.categoryFilter && state.categoryFilter !== 'all')
  );
}

/**
 * Initialize Dashboard
 */
(function initDashboard() {
  console.log('[Dashboard] Initializing with performance optimizations...');

  // Load performance monitor
  if (window.performanceMonitor) {
    performanceMonitor.setEnabled(true);
  }

  // Initialize Web Worker early (disabled due to unresolved errors; re-enable when properly integrated)
  // initWorker().catch(console.warn);

  // Initialize state manager
  initState().then(async (state) => {
    // Initialize offline UI
    offlineUI.init();

    // Set up event listeners with debouncing where appropriate
    setupEventListeners();

    await fetchTaskOptions();
    resetTaskComposer();

    updateStateSnapshot(state);

    // Load project selector options before task fetch
    await loadProjectOptions({ selectedProjectId: state.project_id });

    // Load tasks for current project (or auto-select if none)
    await loadTasks(false);

    // Load saved views for the current project
    const stateAfterLoad = await getState();
    if (stateAfterLoad.project_id) {
      await loadSavedViews(stateAfterLoad.project_id);
    }

    // Get fresh state after tasks loaded
    const newState = await getState();
    updateStateSnapshot(newState);

    // Initial render with skeleton
    renderStartTime = performance.now();
    await renderTasksWithSkeleton(newState);
    const duration = performance.now() - renderStartTime;
    performanceMonitor.record('view-switch-initial', duration, { view: 'list' });
    console.log(`[Dashboard] Initial render completed in ${duration.toFixed(2)}ms`);

    // Update other UI
    renderProjectContext(newState);
    updateStats(newState);
    updateFilterButtons(newState);
    updateSearchSortUI(newState);
    updateThemeUI(newState);
    updateViewButtons(newState);

    // Start periodic incremental sync (every 5 minutes)
    startPeriodicIncrementalSync();

    isInitialized = true;
    console.log('[Dashboard] Ready with optimizations');
  }).catch(error => {
    console.error('[Dashboard] Initialization failed:', error);
    showNotice('Failed to initialize dashboard. Please refresh.', 'error');
  });
})();

/**
 * Initialize Web Worker for filtering/sorting
 */
async function initWorker() {
  try {
    dashboardWorker = new Worker('./dashboard-worker.js', { type: 'module' });
    
    dashboardWorker.onmessage = (e) => {
      const { type, result, duration } = e.data;
      
      if (type === 'FILTER_SORT_COMPLETE') {
        renderWorkerResults(result);
        performanceMonitor.record('filter-sort-worker', duration);
      } else if (type === 'SEARCH_COMPLETE') {
        renderWorkerResults(result);
        performanceMonitor.record('search-worker', duration);
      } else if (type === 'INIT_COMPLETE') {
        workerAvailable = true;
        console.log('[Dashboard] Web Worker initialized');
      }
    };

    dashboardWorker.onerror = (error) => {
      console.error('[Dashboard] Worker error event:', error);
      console.error('  isTrusted:', error.isTrusted);
      console.error('  message (may be ""):', error.message);
      console.error('  filename:', error.filename);
      console.error('  lineno:', error.lineno);
      console.error('  colno:', error.colno);
      // The actual exception is in the non-enumerable .error property
      try {
        const actualError = error.error || (error.detail && error.detail.error);
        if (actualError) {
          console.error('  actual error object:', actualError);
          console.error('  actual error message:', actualError.message);
          console.error('  actual error stack:', actualError.stack);
        } else {
          console.error('  no .error property found');
        }
      } catch (e) {
        console.error('  error while inspecting .error:', e);
      }
      workerAvailable = false;
    };

    // Initialize worker with empty data (will update when we have tasks)
    dashboardWorker.postMessage({ type: 'INIT', data: { tasks: [], categories: [] } });
  } catch (error) {
    console.warn('[Dashboard] Web Worker not available, falling back to main thread:', error);
    workerAvailable = false;
  }
}

/**
 * Keyboard shortcuts handler (accessibility feature)
 * Global keydown event listener for help modal and performance panel
 */
function handleGlobalKeydown(e) {
  // Ignore if user is typing in an input/textarea (except for specific keys)
  const tag = e.target.tagName.toLowerCase();
  const isInput = ['input', 'textarea', 'select', '[contenteditable]'].includes(tag);
  const isEditable = e.target.isContentEditable;

  // ? shows help (always available)
  if (e.key === '?' && !isInput) {
    e.preventDefault();
    showHelpModal();
    return;
  }

  // Escape closes any open modal/panel
  if (e.key === 'Escape') {
    if (!dom.helpModal.hidden) {
      e.preventDefault();
      hideHelpModal();
    } else if (!dom.perfPanel.hidden) {
      e.preventDefault();
      togglePerfPanel(false);
    }
    return;
  }

  // Ctrl+Shift+P toggles performance panel (dev/debug)
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    togglePerfPanel();
    return;
  }
}

/**
 * Show the keyboard help modal with focus trapping
 */
function showHelpModal() {
  dom.helpModal.hidden = false;
  // Save the currently focused element to restore later
  helpPrevFocusElement = document.activeElement;
  // Focus the close button for easy dismissal
  setTimeout(() => dom.helpClose?.focus(), 50);
  // Add basic focus trapping (Esc handles close; return focus on hide)
  document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

/**
 * Hide the keyboard help modal and restore focus
 */
function hideHelpModal() {
  dom.helpModal.hidden = true;
  document.body.style.overflow = '';
  // Restore focus to the previously focused element
  if (helpPrevFocusElement) {
    helpPrevFocusElement.focus();
    helpPrevFocusElement = null;
  }
}

/**
 * Toggle performance monitor panel visibility and update metrics
 * @param {boolean} [show] - If provided, force show (true) or hide (false); otherwise toggle
 */
function togglePerfPanel(show) {
  if (show === true) {
    dom.perfPanel.hidden = false;
  } else if (show === false) {
    dom.perfPanel.hidden = true;
    if (perfInterval) {
      clearInterval(perfInterval);
      perfInterval = null;
    }
  } else {
    // Toggle
    dom.perfPanel.hidden = dom.perfPanel.hidden === true ? false : true;
  }

  // If shown, populate metrics and start auto-refresh
  if (!dom.perfPanel.hidden) {
    updatePerfMetrics();
    // Refresh metrics every 2 seconds while panel is open
    if (!perfInterval) {
      perfInterval = setInterval(updatePerfMetrics, 2000);
    }
  }
}

/**
 * Update the performance metrics display with latest data from performanceMonitor
 */
function updatePerfMetrics() {
  if (!dom.perfMetrics) return;

  const report = performanceMonitor.getReport();
  const m = report.metrics;

  // Build metrics table
  const rows = [];
  for (const [key, stats] of Object.entries(m)) {
    if (stats.count > 0) {
      rows.push(`
        <tr>
          <td>${key}</td>
          <td>${stats.count}</td>
          <td>${stats.avg}ms</td>
          <td>${stats.min}ms</td>
          <td>${stats.max}ms</td>
          <td>${stats.median}ms</td>
        </tr>
      `);
    }
  }

  dom.perfMetrics.innerHTML = `
    <table class="perf-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Count</th>
          <th>Avg</th>
          <th>Min</th>
          <th>Max</th>
          <th>Median</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join('')}
      </tbody>
    </table>
    <div class="perf-recommendations">
      <strong>Recommendations:</strong>
      <ul>
        ${report.recommendations.map(r => `<li>${r}</li>`).join('')}
      </ul>
    </div>
  `;
}

/**
 * Set up all UI event listeners with debouncing where appropriate
 */
function setupEventListeners() {
  // Theme toggle
  dom.themeToggle?.addEventListener('click', () => {
    getState().then(state => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      updateState({ theme: newTheme }).then(() => {
        updateThemeUI(newTheme);
      });
    });
  });

  // Add task (no debounce needed)
  dom.addTaskBtn?.addEventListener('click', async () => {
    const text = dom.taskInput.value.trim();
    if (!text) {
      showNotice('Please enter a task description.', 'error');
      dom.taskInput.focus();
      return;
    }

    const state = await getState();
    if (!state.project_id) {
      showNotice('Select a project before creating a task.', 'error');
      return;
    }
    
    // Show loading state
    skeletonLoader.setButtonLoading(dom.addTaskBtn, 'Create Task');
    
    try {
      const preferredModel = dom.taskModelInput?.value || cachedTaskOptions?.defaults?.model || FALLBACK_DEFAULT_MODEL;
      await addTask({
        text,
        title: text,
        category: dom.categoryInput.value,
        description: dom.taskDescriptionInput?.value || '',
        owner: dom.taskOwnerInput?.value || null,
        status: dom.taskStatusInput?.value || 'backlog',
        priority: dom.taskPriorityInput?.value || 'medium',
        start_date: dom.taskStartDateInput?.value || null,
        due_date: dom.taskDueDateInput?.value || null,
        recurrence_rule: dom.taskRecurrenceInput?.value && dom.taskRecurrenceInput.value !== 'none'
          ? dom.taskRecurrenceInput.value
          : null,
        metadata: buildTaskMetadata({}, { preferredModel })
      });
      resetTaskComposer();
      showNotice('Task added successfully.', 'success');
    } catch (error) {
      showNotice('Failed to add task.', 'error');
    } finally {
      skeletonLoader.clearButtonLoading(dom.addTaskBtn);
    }
  });

  dom.taskInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      dom.addTaskBtn?.click();
    }
  });

  dom.taskDescriptionInput?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      dom.addTaskBtn?.click();
    }
  });

  dom.taskModelInput?.addEventListener('change', () => {
    taskComposerModelDirty = true;
  });

  dom.taskOwnerInput?.addEventListener('change', () => {
    if (taskComposerModelDirty) return;
    const selectedAgent = getAgentCatalog().find(agent => agent.id === dom.taskOwnerInput.value);
    if (selectedAgent?.defaultModel && dom.taskModelInput) {
      dom.taskModelInput.value = selectedAgent.defaultModel;
    } else if (dom.taskModelInput) {
      dom.taskModelInput.value = cachedTaskOptions?.defaults?.model || FALLBACK_DEFAULT_MODEL;
    }
  });

  // Filter buttons (debounced to prevent rapid re-renders)
  dom.filterButtons?.forEach(button => {
    button.addEventListener('click', async () => {
      const filter = button.dataset.filter;
      await updateState({ filter });
      // Load tasks with appropriate inclusion of archived
      const includeArchived = filter === 'archived';
      await loadTasks(includeArchived);
      await renderTasksDebounced();
      updateFilterButtons(getStateSync());
    });
  });

  // Search (debounced - 200ms delay)
  dom.searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    const search = e.target.value;
    
    // Show skeleton if large dataset
    const state = getStateSync(); // Fast sync check
    if (state.tasks.length > 50) {
      showTaskSkeletons(Math.min(8, Math.ceil(state.tasks.length / 20)));
    }
    
    searchDebounceTimer = setTimeout(async () => {
      await updateState({ search });
      await renderTasksDebounced();
    }, 200);
  });

  // Category filter (debounced)
  dom.categoryFilter?.addEventListener('change', (e) => {
    updateState({ categoryFilter: e.target.value }).then(() => {
      renderTasksDebounced();
    });
  });

  dom.projectSelect?.addEventListener('change', async (e) => {
    const projectId = e.target.value;
    if (!projectId) return;
    await selectProject(projectId);
  });

  dom.projectAddRootBtn?.addEventListener('click', () => {
    openProjectForm('create-root');
  });

  dom.projectAddChildBtn?.addEventListener('click', () => {
    const project = getProjectFromCatalog(getStateSync().project_id);
    openProjectForm('create-child', project);
  });

  dom.projectEditBtn?.addEventListener('click', () => {
    const project = getProjectFromCatalog(getStateSync().project_id);
    openProjectForm('edit', project);
  });

  dom.projectArchiveBtn?.addEventListener('click', () => {
    const project = getProjectFromCatalog(getStateSync().project_id);
    handleArchiveProject(project);
  });

  dom.projectFormPanel?.addEventListener('submit', handleProjectFormSubmit);
  dom.projectCancelBtn?.addEventListener('click', () => {
    closeProjectForm();
  });

  // Sort (immediate)
  dom.sortSelect?.addEventListener('change', (e) => {
    updateState({ sort: e.target.value }).then(() => {
      renderTasksDebounced();
    });
  });

  // Export buttons
  dom.exportJsonBtn?.addEventListener('click', exportJson);
  dom.exportCsvBtn?.addEventListener('click', exportCsv);

  // Import
  dom.importBtn?.addEventListener('click', () => {
    dom.importFile?.click();
  });
  dom.importFile?.addEventListener('change', handleImport);

  // Clear completed
  dom.clearCompletedBtn?.addEventListener('click', async () => {
    try {
      await handleClearCompleted();
    } catch (error) {
      showNotice('Failed to clear completed tasks.', 'error');
    }
  });

  // Saved Views
  dom.saveViewBtn?.addEventListener('click', handleSaveView);
  dom.savedViewSelect?.addEventListener('change', handleApplyView);
  dom.deleteViewBtn?.addEventListener('click', handleDeleteView);

  // Subscribe to state changes
  subscribe(async (event, state) => {
    updateStateSnapshot(state);
    switch (event) {
      case 'load':
      case 'change':
        await syncUI(state);
        break;
    }
  });

  // View switcher
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      updateState({ view }).then(async () => {
        const state = await getState();
        renderViewSwitch(view, state);
        updateViewButtons(state);
      });
    });
  });

  // Global keyboard shortcuts
  window.addEventListener('keydown', handleGlobalKeydown);
  
  // Show performance panel if URL hash indicates it
  if (window.location.hash === '#perf') {
    togglePerfPanel(true);
  }

  // Close buttons for modals/panels
  dom.helpClose?.addEventListener('click', hideHelpModal);
  dom.perfClose?.addEventListener('click', () => togglePerfPanel(false));
}

/**
 * Synchronize all UI elements with current state
 */
async function syncUI(state) {
  await renderCategoryOptions();
  await renderTasks(); // Handles skeleton loading internally
  renderProjectContext(state);
  await updateStats(state);
  updateFilterButtons(state);
  updateSearchSortUI(state);
  updateThemeUI(state);
  updateViewButtons(state);
  renderSavedViewOptions();
}

/**
 * Render category options dropdown
 */
async function renderCategoryOptions() {
  const state = await getState();
  dom.categoryOptions.innerHTML = '';
  state.categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    dom.categoryOptions.appendChild(option);
  });

  // Update category filter dropdown
  dom.categoryFilter.innerHTML = '<option value="all">All categories</option>';
  state.categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    dom.categoryFilter.appendChild(option);
  });
  dom.categoryFilter.value = state.categoryFilter;
}

function updateStateSnapshot(state) {
  latestStateSnapshot = {
    tasks: [],
    categories: [],
    savedViews: [],
    ...state
  };
}

function buildProjectOptionLabel(project) {
  const normalizedProject = normalizeProject(project);
  if (!normalizedProject) return '';

  const depth = Math.max(0, Number(normalizedProject.depth || 0));
  const taskCount = getProjectVisibleTaskCount(normalizedProject);
  const blockedCount = getProjectVisibleBlockedCount(normalizedProject);
  const overdueCount = getProjectVisibleOverdueCount(normalizedProject);
  const suffix = [];

  if (taskCount > 0) suffix.push(`${taskCount} tasks`);
  if (blockedCount > 0) suffix.push(`${blockedCount} blocked`);
  if (overdueCount > 0) suffix.push(`${overdueCount} overdue`);

  const indent = depth > 0 ? `${'  '.repeat(depth)}` : '';
  const kindLabel = projectHasChildren(normalizedProject) ? '[Folder] ' : '';
  const label = `${indent}${kindLabel}${normalizedProject.name}`;
  return suffix.length > 0 ? `${label} (${suffix.join(', ')})` : label;
}

async function fetchProjectById(projectId) {
  if (!projectId) return null;
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!res.ok) return null;
  const project = await res.json();
  return mergeProjectIntoCatalog(project);
}

async function fetchDefaultProject() {
  const res = await fetch('/api/projects/default?status=active');
  if (!res.ok) return null;
  const project = await res.json();
  return mergeProjectIntoCatalog(project);
}

async function loadProjectOptions(options = {}) {
  if (!dom.projectSelect) return [];

  const selectedProjectId = options.selectedProjectId || '';
  dom.projectSelect.disabled = true;
  dom.projectSelect.innerHTML = '<option value="">Loading projects...</option>';

  try {
    const res = await fetch(`/api/projects?status=active&include_meta=true&limit=${PROJECT_SELECTOR_PAGE_SIZE}`);
    if (!res.ok) throw new Error(`Failed to load projects: ${res.status}`);

    const payload = await res.json();
    const projects = Array.isArray(payload?.items) ? payload.items.map(normalizeProject).filter(Boolean) : [];
    const total = Number(payload?.total || projects.length);

    let selectedProject = options.injectProject || null;
    if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) {
      selectedProject = selectedProject || await fetchProjectById(selectedProjectId);
      if (selectedProject) {
        projects.unshift(selectedProject);
      }
    }

    setProjectCatalog(projects);

    dom.projectSelect.innerHTML = '';

    if (projects.length === 0) {
      dom.projectSelect.innerHTML = '<option value="">No active projects</option>';
      dom.projectSelect.disabled = true;
      return [];
    }

    projects.forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = buildProjectOptionLabel(project);
      dom.projectSelect.appendChild(option);
    });

    if (total > projects.length) {
      const moreOption = document.createElement('option');
      moreOption.value = '';
      moreOption.textContent = `Showing ${projects.length} of ${total} projects`;
      moreOption.disabled = true;
      dom.projectSelect.appendChild(moreOption);
    }

    const fallbackProjectId = selectedProjectId || projects[0]?.id || '';
    if (fallbackProjectId && projects.some((project) => project.id === fallbackProjectId)) {
      dom.projectSelect.value = fallbackProjectId;
    }

    dom.projectSelect.disabled = false;
    return projects;
  } catch (error) {
    console.error('[Dashboard] Failed to load project options:', error);
    dom.projectSelect.innerHTML = '<option value="">Failed to load projects</option>';
    dom.projectSelect.disabled = true;
    setProjectCatalog([]);
    return [];
  }
}

async function selectProject(projectId) {
  if (!projectId) return;
  closeProjectForm();

  const state = await getState();
  if (state.project_id === projectId) {
    renderProjectContext(state);
    return;
  }

  const nextState = {
    ...state,
    project_id: projectId,
    tasks: [],
    categories: ['General'],
    lastSyncTime: null,
    search: '',
    categoryFilter: 'all',
    filter: 'all',
    savedViews: [],
    activeSavedViewId: null
  };

  await setState(nextState);
  await loadSavedViews(projectId);
  await loadTasks(false);
}

function closeProjectForm() {
  if (!dom.projectFormPanel) return;
  dom.projectFormPanel.hidden = true;
  if (dom.projectFormMode) dom.projectFormMode.value = '';
  if (dom.projectFormProjectId) dom.projectFormProjectId.value = '';
  if (dom.projectNameInput) dom.projectNameInput.value = '';
  if (dom.projectDescriptionInput) dom.projectDescriptionInput.value = '';
  if (dom.projectStatusInput) dom.projectStatusInput.value = 'active';
  if (dom.projectParentSelect) {
    dom.projectParentSelect.innerHTML = '<option value="">No parent (root project)</option>';
    dom.projectParentSelect.value = '';
  }
}

function populateProjectParentOptions(selectedParentId = '', excludedProjectIds = []) {
  if (!dom.projectParentSelect) return;

  const blockedIds = new Set(excludedProjectIds.filter(Boolean));
  dom.projectParentSelect.innerHTML = '<option value="">No parent (root project)</option>';

  projectCatalog
    .filter((project) => !blockedIds.has(project.id))
    .forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      const indent = project.depth > 0 ? `${'  '.repeat(project.depth)}` : '';
      option.textContent = `${indent}${project.name}`;
      dom.projectParentSelect.appendChild(option);
    });

  dom.projectParentSelect.value = selectedParentId || '';
}

function openProjectForm(mode, project = null) {
  if (!dom.projectFormPanel) return;

  const currentProject = project || getProjectFromCatalog(getStateSync().project_id);
  const isEdit = mode === 'edit';
  const isCreateChild = mode === 'create-child';
  const excludedIds = isEdit && currentProject
    ? [currentProject.id, ...getProjectDescendantIds(currentProject.id)]
    : [];
  const selectedParentId = isEdit
    ? (currentProject?.parent_project_id || '')
    : (isCreateChild ? currentProject?.id || '' : '');

  populateProjectParentOptions(selectedParentId, excludedIds);

  dom.projectFormPanel.hidden = false;
  dom.projectFormMode.value = mode;
  dom.projectFormProjectId.value = isEdit && currentProject ? currentProject.id : '';
  dom.projectNameInput.value = isEdit && currentProject ? currentProject.name || '' : '';
  dom.projectDescriptionInput.value = isEdit && currentProject ? currentProject.description || '' : '';
  dom.projectStatusInput.value = isEdit && currentProject ? (currentProject.status || 'active') : 'active';

  if (mode === 'create-root') {
    dom.projectFormTitle.textContent = 'Create root project';
    dom.projectFormSubtitle.textContent = 'Start a new top-level board that can hold its own tasks or become a folder for child projects.';
  } else if (mode === 'create-child') {
    dom.projectFormTitle.textContent = `Add child project${currentProject ? ` to ${currentProject.name}` : ''}`;
    dom.projectFormSubtitle.textContent = 'Create a related board under the current project so work stays grouped in a clean hierarchy.';
  } else {
    dom.projectFormTitle.textContent = `Edit ${currentProject?.name || 'project'}`;
    dom.projectFormSubtitle.textContent = 'Rename the project, change its description, or move it somewhere else in the hierarchy.';
  }

  requestAnimationFrame(() => {
    dom.projectNameInput?.focus();
    dom.projectNameInput?.select();
  });
}

async function handleProjectFormSubmit(event) {
  event.preventDefault();

  const mode = dom.projectFormMode?.value || '';
  const projectId = dom.projectFormProjectId?.value || '';
  const name = dom.projectNameInput?.value.trim() || '';

  if (!name) {
    showNotice('Project name is required.', 'error');
    dom.projectNameInput?.focus();
    return;
  }

  const description = dom.projectDescriptionInput?.value.trim() || '';
  const status = dom.projectStatusInput?.value || 'active';
  const parentId = dom.projectParentSelect?.value || '';
  const selectedProject = getProjectFromCatalog(getStateSync().project_id);
  const currentProject = projectId ? getProjectFromCatalog(projectId) : null;
  const baseMetadata = currentProject?.metadata && typeof currentProject.metadata === 'object'
    ? { ...currentProject.metadata }
    : {};

  if (parentId) {
    baseMetadata.parent_project_id = parentId;
  } else {
    delete baseMetadata.parent_project_id;
  }

  const payload = {
    name,
    description,
    status,
    metadata: baseMetadata
  };

  try {
    let savedProject = null;
    if (mode === 'edit' && projectId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Failed to update project: ${response.status}`);
      }
      savedProject = normalizeProject(await response.json());
      showNotice('Project updated.', 'success');
    } else {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Failed to create project: ${response.status}`);
      }
      savedProject = normalizeProject(await response.json());
      showNotice('Project created.', 'success');
    }

    closeProjectForm();
    const targetProjectId = savedProject?.id || selectedProject?.id;
    await loadProjectOptions({ selectedProjectId: targetProjectId, injectProject: savedProject });
    if (targetProjectId) {
      await selectProject(targetProjectId);
    }
  } catch (error) {
    console.error('[Dashboard] Project save failed:', error);
    showNotice('Failed to save project.', 'error');
  }
}

async function archiveProjectTree(project) {
  if (!project) return;

  const branch = projectCatalog
    .filter((item) => Array.isArray(item.project_path_ids) && item.project_path_ids.includes(project.id))
    .sort((left, right) => Number(right.depth || 0) - Number(left.depth || 0));

  for (const item of branch) {
    const response = await fetch(`/api/projects/${encodeURIComponent(item.id)}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to archive project: ${item.name}`);
    }
  }
}

async function handleArchiveProject(project = null) {
  const currentProject = project || getProjectFromCatalog(getStateSync().project_id);
  if (!currentProject) return;

  const descendantCount = getProjectDescendantIds(currentProject.id).length;
  const promptText = descendantCount > 0
    ? `Archive "${currentProject.name}" and its ${descendantCount} child project${descendantCount === 1 ? '' : 's'}?`
    : `Archive "${currentProject.name}"?`;

  if (!window.confirm(promptText)) {
    return;
  }

  try {
    await archiveProjectTree(currentProject);
    closeProjectForm();
    showNotice('Project archived.', 'success');
    await loadProjectOptions();
    const state = await getState();
    const fallbackProjectId = currentProject.parent_project_id || (await fetchDefaultProject())?.id || '';
    if (fallbackProjectId) {
      await selectProject(fallbackProjectId);
    } else if (state.project_id === currentProject.id) {
      await setState({ ...state, project_id: null, tasks: [] });
    }
  } catch (error) {
    console.error('[Dashboard] Project archive failed:', error);
    showNotice('Failed to archive project.', 'error');
  }
}

function renderProjectContext(state) {
  if (!dom.projectContext || !dom.projectBreadcrumb || !dom.projectSummary || !dom.projectJumpLinks) {
    return;
  }

  const project = getProjectFromCatalog(state.project_id);
  if (!project) {
    dom.projectContext.hidden = true;
    dom.projectBreadcrumb.innerHTML = '';
    if (dom.projectCurrentName) dom.projectCurrentName.textContent = '';
    if (dom.projectKindBadge) dom.projectKindBadge.textContent = '';
    dom.projectSummary.textContent = '';
    if (dom.projectMetrics) dom.projectMetrics.innerHTML = '';
    if (dom.projectNavigatorSummary) dom.projectNavigatorSummary.textContent = '';
    dom.projectJumpLinks.innerHTML = '';
    closeProjectForm();
    return;
  }

  dom.projectContext.hidden = false;
  dom.projectBreadcrumb.innerHTML = '';

  const pathIds = Array.isArray(project.project_path_ids) && project.project_path_ids.length > 0
    ? project.project_path_ids
    : [project.id];
  const pathNames = Array.isArray(project.project_path_names) && project.project_path_names.length > 0
    ? project.project_path_names
    : [project.name];

  pathNames.forEach((name, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'project-breadcrumb-sep';
      separator.textContent = '/';
      dom.projectBreadcrumb.appendChild(separator);
    }

    const segmentProjectId = pathIds[index];
    if (index < pathNames.length - 1 && segmentProjectId) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.addEventListener('click', () => {
        selectProject(segmentProjectId);
      });
      dom.projectBreadcrumb.appendChild(button);
      return;
    }

    const current = document.createElement('span');
    current.className = 'project-breadcrumb-current';
    current.textContent = name;
    dom.projectBreadcrumb.appendChild(current);
  });

  if (dom.projectCurrentName) {
    dom.projectCurrentName.textContent = project.name;
  }
  if (dom.projectKindBadge) {
    dom.projectKindBadge.textContent = projectHasChildren(project) ? 'Folder' : 'Project';
  }

  const visibleTaskCount = getProjectVisibleTaskCount(project);
  const activeTaskCount = getProjectVisibleActiveCount(project);
  const overdueCount = getProjectVisibleOverdueCount(project);
  const completedCount = Number(projectHasChildren(project)
    ? project.rollup_completed_count ?? 0
    : project.completed_count ?? 0);
  const childCount = Number(project.child_count || 0);
  const folderSummary = projectHasChildren(project)
    ? `Folder rollup across ${childCount} child board${childCount === 1 ? '' : 's'}.`
    : 'Focused board for direct task execution.';

  dom.projectSummary.textContent = `${folderSummary} ${visibleTaskCount} total tasks, ${activeTaskCount} active, ${completedCount} completed, ${overdueCount} overdue.`;

  if (dom.projectMetrics) {
    const metrics = [
      { label: 'Total tasks', value: visibleTaskCount },
      { label: 'Active work', value: activeTaskCount },
      { label: 'Completed', value: completedCount },
      { label: projectHasChildren(project) ? 'Child boards' : 'Depth', value: projectHasChildren(project) ? childCount : Number(project.depth || 0) }
    ];

    dom.projectMetrics.innerHTML = '';
    metrics.forEach((metric) => {
      const card = document.createElement('div');
      card.className = 'project-metric-card';
      const strong = document.createElement('strong');
      strong.textContent = String(metric.value);
      const label = document.createElement('span');
      label.textContent = metric.label;
      card.append(strong, label);
      dom.projectMetrics.appendChild(card);
    });
  }

  dom.projectJumpLinks.innerHTML = '';
  const rootProject = getProjectRoot(project);
  const childrenMap = buildProjectChildrenMap();

  if (dom.projectNavigatorSummary) {
    dom.projectNavigatorSummary.textContent = `Folder map for ${rootProject?.name || project.name}. Select any board in the tree to navigate the current workspace hierarchy.`;
  }

  const renderTreeNode = (treeProject, depth = 0) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'project-tree-node';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'project-tree-item';
    if (depth === 0) {
      button.classList.add('project-tree-item--root');
    }
    if (treeProject.id === project.id) {
      button.classList.add('project-tree-item--active');
    } else if (pathIds.includes(treeProject.id)) {
      button.classList.add('project-tree-item--branch');
    }
    if (projectHasChildren(treeProject)) {
      button.classList.add('project-tree-item--folder');
    }
    button.addEventListener('click', () => {
      selectProject(treeProject.id);
    });

    const kicker = document.createElement('span');
    kicker.className = 'project-tree-kicker';
    kicker.textContent = depth === 0 ? 'Workspace root' : (projectHasChildren(treeProject) ? 'Folder' : 'Child board');

    const title = document.createElement('div');
    title.className = 'project-tree-title';
    const name = document.createElement('span');
    name.textContent = treeProject.name;
    const badge = document.createElement('span');
    badge.className = 'project-nav-badge';
    badge.textContent = `${getProjectVisibleTaskCount(treeProject)} tasks`;
    title.append(name, badge);

    const meta = document.createElement('div');
    meta.className = 'project-tree-meta';
    meta.textContent = `${getProjectVisibleActiveCount(treeProject)} active, ${getProjectVisibleOverdueCount(treeProject)} overdue${projectHasChildren(treeProject) ? `, ${treeProject.child_count} child boards` : ''}.`;

    button.append(kicker, title, meta);
    wrapper.appendChild(button);

    const childProjects = childrenMap.get(treeProject.id) || [];
    if (childProjects.length > 0) {
      const branch = document.createElement('div');
      branch.className = 'project-tree-children';
      childProjects.forEach((childProject) => {
        branch.appendChild(renderTreeNode(childProject, depth + 1));
      });
      wrapper.appendChild(branch);
    }

    return wrapper;
  };

  if (rootProject) {
    dom.projectJumpLinks.appendChild(renderTreeNode(rootProject, 0));
  }

  if (dom.projectAddChildBtn) {
    dom.projectAddChildBtn.disabled = false;
    dom.projectAddChildBtn.textContent = 'Add child';
  }
  if (dom.projectEditBtn) {
    dom.projectEditBtn.disabled = false;
  }
  if (dom.projectArchiveBtn) {
    dom.projectArchiveBtn.disabled = false;
    dom.projectArchiveBtn.textContent = projectHasChildren(project) ? 'Archive tree' : 'Archive';
  }
}

async function ensureSelectedProject(state) {
  if (state.project_id) {
    const existingProject = await fetchProjectById(state.project_id);
    if (existingProject) {
      await loadProjectOptions({
        selectedProjectId: state.project_id,
        injectProject: existingProject
      });
      return state.project_id;
    }
  }

  const defaultProject = await fetchDefaultProject();
  if (!defaultProject) {
    await loadProjectOptions();
    showNotice('No active projects available.', 'error');
    return null;
  }

  const nextState = {
    ...state,
    project_id: defaultProject.id,
    tasks: [],
    categories: ['General'],
    lastSyncTime: null,
    search: '',
    categoryFilter: 'all',
    filter: 'all',
    savedViews: [],
    activeSavedViewId: null
  };

  await setState(nextState);
  await loadProjectOptions({
    selectedProjectId: defaultProject.id,
    injectProject: defaultProject
  });

  return defaultProject.id;
}

/**
 * Render saved views options in the select dropdown
 */
function renderSavedViewOptions() {
  if (!dom.savedViewSelect) return;
  const state = getStateSync() || {};
  const views = Array.isArray(state.savedViews) ? state.savedViews : [];

  // Remember current selection
  const currentValue = dom.savedViewSelect.value;

  // Clear all except first placeholder
  dom.savedViewSelect.innerHTML = '<option value="">Load view...</option>';

  views.forEach(view => {
    const option = document.createElement('option');
    option.value = view.id;
    option.textContent = view.name;
    if (view.id === currentValue) {
      option.selected = true;
    } else if (view.id === state.activeSavedViewId) {
      option.selected = true;
    }
    dom.savedViewSelect.appendChild(option);
  });

  // If not matching any, reset to placeholder
  if (!views.find(v => v.id === currentValue) && currentValue !== '') {
    dom.savedViewSelect.value = '';
  }
}

/**
 * Load saved views for current project from API
 */
async function loadSavedViews(projectId) {
  if (!projectId) return;
  try {
    const res = await fetch(`/api/views?project_id=${encodeURIComponent(projectId)}`);
    if (!res.ok) {
      if (res.status === 404) {
        await setSavedViews([]);
        return;
      }
      throw new Error(`Failed to fetch saved views: ${res.status}`);
    }
    const views = await res.json();
    await setSavedViews(views);
  } catch (err) {
    console.error('[Dashboard] loadSavedViews error:', err);
  }
}

/**
 * Handle Save View button click
 */
async function handleSaveView() {
  const state = await getState();
  if (!state.project_id) {
    showNotice('Please select a project first.', 'error');
    return;
  }
  const name = prompt('Enter a name for this view:');
  if (!name) return; // cancelled

  const filters = {
    filter: state.filter,
    search: state.search,
    categoryFilter: state.categoryFilter,
    sort: state.sort
  };

  try {
    const res = await fetch('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: state.project_id,
        name,
        filters,
        sort: state.sort,
        created_by: 'main'
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save view');
    }
    const view = await res.json();
    await addSavedView(view);
    showNotice('View saved.', 'success');
    await loadSavedViews(state.project_id); // refresh
    dom.savedViewSelect.value = view.id;
    setActiveView(view.id);
  } catch (err) {
    showNotice(`Save failed: ${err.message}`, 'error');
  }
}

/**
 * Handle Apply View from select
 */
async function handleApplyView() {
  const viewId = dom.savedViewSelect.value;
  if (!viewId) {
    // If placeholder selected, clear active view
    await setActiveView(null);
    return;
  }
  const state = (await getState()) || {};
  const views = Array.isArray(state.savedViews) ? state.savedViews : [];
  const view = views.find(v => v.id === viewId);
  if (!view) {
    showNotice('View not found.', 'error');
    return;
  }

  const updates = {
    filter: view.filters.filter || 'all',
    search: view.filters.search || '',
    categoryFilter: view.filters.categoryFilter || 'all',
    sort: view.filters.sort || 'newest',
    activeSavedViewId: viewId
  };
  await updateState(updates);
  await loadTasks(false);
}

/**
 * Handle Delete View button click
 */
async function handleDeleteView() {
  const viewId = dom.savedViewSelect.value;
  if (!viewId) {
    showNotice('No view selected to delete.', 'error');
    return;
  }
  const confirmed = confirm('Delete this saved view?');
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/views/${viewId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete view');
    }
    await removeSavedView(viewId);
    showNotice('View deleted.', 'success');
    dom.savedViewSelect.value = '';
    const state = (await getState()) || {};
    await loadSavedViews(state.project_id);
  } catch (err) {
    showNotice(`Delete failed: ${err.message}`, 'error');
  }
}

/**
 * Render tasks with virtual scrolling for large datasets
 * Uses skeleton loading during operation
 */
async function renderTasksWithSkeleton(state) {
  // Show skeleton loading if we have a significant number of tasks
  const filteredTaskCount = computeVisibleHierarchy(
    getFilteredTasksSync(state),
    expandedTaskIds,
    state
  ).length;
  
  if (filteredTaskCount > 0) {
    // For small datasets, render normally
    if (filteredTaskCount <= 100) {
      // Ensure virtual scroller is destroyed if active
      if (virtualScroller) {
        virtualScroller.destroy();
        virtualScroller = null;
        isVirtualScrolling = false;
        dom.taskList.style = '';
      }
      renderTasksNormal(state);
    } else {
      // For large datasets, use virtual scrolling
      if (!virtualScroller) {
        await initVirtualScroller();
      }
      renderTasksVirtual(state);
    }
  } else {
    // No tasks, clear list
    dom.taskList.innerHTML = '';
    dom.emptyState.style.display = 'block';
    dom.emptyMessage.textContent = 'No tasks yet. Add one above!';
  }
}

/**
 * Render tasks using normal DOM (for <=100 tasks)
 */
async function renderTasksNormal(state) {
  const filteredTasks = getFilteredTasksSync(state);
  const tasks = computeVisibleHierarchy(filteredTasks, expandedTaskIds, state);
  
  // Clear task list
  dom.taskList.innerHTML = '';
  
  if (tasks.length === 0) {
    dom.emptyState.style.display = 'block';
    if (state.search) {
      dom.emptyMessage.textContent = 'No tasks match your search.';
    } else if (state.filter === 'all') {
      dom.emptyMessage.textContent = 'No tasks yet. Add one above!';
    } else {
      dom.emptyMessage.textContent = `No ${state.filter} tasks right now.`;
    }
    return;
  }

  dom.emptyState.style.display = 'none';
  
  // Use document fragment for batch DOM insertion
  const fragment = document.createDocumentFragment();
  
  // Limit concurrent DOM operations to prevent jank
  const chunkSize = 25;
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const chunk = tasks.slice(i, i + chunkSize);
    chunk.forEach(task => {
      const listItem = createTaskElement(task);
      fragment.appendChild(listItem);
    });
    
    // Allow browser to render after each chunk if large dataset
    if (tasks.length > 50 && i % (chunkSize * 2) === 0) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  
  dom.taskList.appendChild(fragment);
}

/**
 * Initialize virtual scroller for large datasets
 */
async function initVirtualScroller() {
  // Dynamic import to avoid loading if not needed
  if (!VirtualScroller) {
    const module = await import('./virtual-scroller.mjs');
    VirtualScroller = module.VirtualScroller || module.default;
  }

  // Ensure tasks container can be virtualized
  dom.taskList.style.display = 'flex';
  dom.taskList.style.flexDirection = 'column';
  
  virtualScroller = new VirtualScroller({
    container: dom.taskList,
    itemHeight: 100, // Estimated, will adjust based on measurements
    buffer: 10,
    renderItem: (task, index) => {
      const element = createTaskElement(task);
      element.style.position = 'absolute';
      element.style.top = `${index * 100}px`;
      element.style.width = '100%';
      element.style.boxSizing = 'border-box';
      return element;
    }
  });
  
  isVirtualScrolling = true;
  console.log('[Dashboard] Virtual scroller initialized');
}

/**
 * Render tasks using virtual scrolling
 */
async function renderTasksVirtual(state) {
  const filteredTasks = getFilteredTasksSync(state);
  const tasks = computeVisibleHierarchy(filteredTasks, expandedTaskIds, state);
  
  if (tasks.length === 0) {
    dom.emptyState.style.display = 'block';
    if (state.search) {
      dom.emptyMessage.textContent = 'No tasks match your search.';
    } else if (state.filter === 'all') {
      dom.emptyMessage.textContent = 'No tasks yet. Add one above!';
    } else {
      dom.emptyMessage.textContent = `No ${state.filter} tasks right now.`;
    }
    return;
  }

  dom.emptyState.style.display = 'none';
  
  // Update virtual scroller items
  virtualScroller.setItems(tasks);
}

/**
 * Debounced render tasks (for rapid successive updates)
 */
let renderTasksTimeout = null;
async function renderTasksDebounced() {
  clearTimeout(renderTasksTimeout);
  renderTasksTimeout = setTimeout(async () => {
    const startTime = performance.now();
    const state = await getState();
    await renderTasksWithSkeleton(state);
    const duration = performance.now() - startTime;
    performanceMonitor.record('render-tasks', duration, { 
      taskCount: state.tasks.length,
      view: currentView 
    });
  }, 50);
}

/**
 * Load tasks from the Asana API for the current project.
 * @param {boolean} includeArchived - Whether to include archived tasks.
 */
async function loadTasks(includeArchived = false, options = {}) {
  let state = await getState();
  const projectId = await ensureSelectedProject(state);
  if (!projectId) return;
  const requestId = ++activeTaskLoadRequest;

  if (projectId !== state.project_id) {
    await loadSavedViews(projectId);
    state = await getState();
  }

  try {
    let project = getProjectFromCatalog(projectId);
    if (!project) {
      project = await fetchProjectById(projectId);
    }
    const includeChildProjects = projectHasChildren(project);

    let url = `/api/tasks/all?project_id=${encodeURIComponent(projectId)}&include_archived=${includeArchived}&include_child_projects=${includeChildProjects}`;
    if (options.updated_since) {
      url += `&updated_since=${encodeURIComponent(options.updated_since)}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
    const tasks = await res.json();
    if (requestId !== activeTaskLoadRequest) return;

    const latestState = await getState();
    if (latestState.project_id && latestState.project_id !== projectId) {
      return;
    }
    if (!options.updated_since && includeArchived !== (latestState.filter === 'archived')) {
      return;
    }

    // If this is an incremental fetch (updated_since provided), merge into existing tasks.
    if (options.updated_since) {
      // Build a map of existing tasks by id
      const existingMap = new Map(latestState.tasks.map(t => [t.id, t]));
      // Update or add incoming tasks
      for (const task of tasks) {
        existingMap.set(task.id, task);
      }
      // Convert back to array, preserving order? Sort by updatedAt descending? Keep existing order for now.
      const mergedTasks = Array.from(existingMap.values());
      await setState({ ...latestState, project_id: projectId, tasks: mergedTasks, lastSyncTime: new Date().toISOString() });
    } else {
      // Full replace
      await setState({ ...latestState, project_id: projectId, tasks, lastSyncTime: new Date().toISOString() });
    }

    // Update project selector UI if present
    if (dom.projectSelect) {
      dom.projectSelect.value = projectId;
    }
  } catch (error) {
    console.error('[Dashboard] loadTasks error:', error);
    showNotice('Failed to load tasks.', 'error');
  }
}

/**
 * Start periodic incremental sync to pull changes from server
 */
function startPeriodicIncrementalSync() {
  if (incrementalSyncInterval) {
    clearInterval(incrementalSyncInterval);
  }
  incrementalSyncInterval = setInterval(async () => {
    const state = await getState();
    if (!state.project_id || !state.lastSyncTime) return;
    try {
      await loadTasks(false, { updated_since: state.lastSyncTime });
      console.log('[Dashboard] Incremental sync completed');
    } catch (err) {
      console.error('[Dashboard] Incremental sync failed:', err);
    }
  }, INCREMENTAL_SYNC_INTERVAL_MS);
}

/**
 * Main render tasks function (called by synUI)
 */
async function renderTasks() {
  const state = await getState();
  await renderTasksWithSkeleton(state);
}

/**
 * Render timeline view with lazy loading
 */
async function renderTimelineView(state) {
  // Dynamic import for timeline view (only when needed)
  if (!TimelineView) {
    try {
      const module = await import('./timeline-view.mjs');
      TimelineView = module.TimelineView || module.default;
    } catch (error) {
      console.error('[Dashboard] Failed to load timeline view:', error);
      showNotice('Timeline view unavailable. Showing list view.', 'error');
      await renderTasksWithSkeleton(state);
      return;
    }
  }

  // Create timeline instance
  try {
    window.timelineViewInstance = new TimelineView(dom.taskList, {
      dateFormat: 'MMM d, yyyy',
      groupByDay: true,
      maxVisibleGroups: 50,
      bufferGroups: 5
    });
    
    // Set and render tasks
    window.timelineViewInstance.setTasks(state.tasks);
    window.timelineViewInstance.updateFiltered(getFilteredTasksSync(state));
    
    // Show skeleton while first rendering
    showTaskSkeletons(Math.min(5, Math.ceil(state.tasks.length / 50)));
    
    // Small delay to show skeleton and allow browser to render
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('[Dashboard] Timeline view initialized with lazy loading');
  } catch (error) {
    console.error('[Dashboard] Timeline view rendering failed:', error);
    showNotice('Failed to render timeline view. Showing list view.', 'error');
    await renderTasksWithSkeleton(state);
  }
}

/**
 * Render board view (Kanban).
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
 */
async function renderBoardView(state) {
  // Dynamic import for board view (only when needed)
  if (!BoardView) {
    try {
      const module = await import('./board-view.mjs');
      BoardView = module.BoardView || module.default;
    } catch (error) {
      console.error('[Dashboard] Failed to load board view:', error);
      showNotice('Board view unavailable. Showing list view.', 'error');
      await renderTasksWithSkeleton(state);
      return;
    }
  }

  // Require project ID
  if (!state.project_id) {
    showNotice('No project selected for board view.', 'error');
    await renderTasksWithSkeleton(state);
    return;
  }

  try {
    boardViewInstance = new BoardView(dom.taskList, {
      columnOrder: ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'completed']
    });
    await boardViewInstance.setProjectId(state.project_id);
    console.log('[Dashboard] Board view initialized');
  } catch (error) {
    console.error('[Dashboard] Board view rendering failed:', error);
    showNotice('Failed to render board view. Showing list view.', 'error');
    await renderTasksWithSkeleton(state);
  }
}

/**
 * Get filtered tasks synchronously (for rendering)
 */
/**
 * Render cron jobs view
 * @param {Object} state - Current state (unused but kept for signature)
 */
async function renderCronView(state) {
  // Dynamic import for cron view (only when needed)
  if (!cronViewInstance) {
    try {
      const module = await import('./cron-view.mjs');
      const CronViewClass = module.CronView || module.default;
      cronViewInstance = new CronViewClass(dom.taskList, {
        // Options if any
      });
    } catch (error) {
      console.error('[Dashboard] Failed to load cron view:', error);
      showNotice('Cron view unavailable. Showing list view.', 'error');
      await renderTasksWithSkeleton(state);
      return;
    }
  }

  try {
    // Load and render cron jobs
    await cronViewInstance.load();
    console.log('[Dashboard] Cron view initialized');
  } catch (error) {
    console.error('[Dashboard] Cron view rendering failed:', error);
    showNotice('Failed to load cron jobs. Showing list view.', 'error');
    await renderTasksWithSkeleton(state);
  }
}

function getFilteredTasksSync(state) {
  let filtered = state.tasks;

  // Filter by status
  if (state.filter === 'pending') {
    filtered = filtered.filter(task => isTaskPending(task));
  } else if (state.filter === 'completed') {
    filtered = filtered.filter(task => isTaskCompleted(task));
  } else if (state.filter === 'archived') {
    filtered = filtered.filter(task => isTaskArchived(task));
  } else if (state.filter === 'my_tasks') {
    if (currentAgent) {
      filtered = filtered.filter(task => task.owner === currentAgent && !isTaskArchived(task));
    } else {
      filtered = [];
    }
  } else if (state.filter === 'overdue') {
    const now = new Date();
    filtered = filtered.filter(task => {
      if (!isTaskPending(task)) return false;
      if (!task.due_date) return false;
      try {
        return new Date(task.due_date) < now;
      } catch (e) {
        return false;
      }
    });
  } else if (state.filter === 'blocked') {
    const taskById = new Map(state.tasks.map(t => [t.id, t]));
    filtered = filtered.filter(task => {
      if (isTaskArchived(task) || isTaskCompleted(task)) return false;
      if (task.status === 'blocked') return true;
      if (task.dependency_ids && task.dependency_ids.length > 0) {
        for (const depId of task.dependency_ids) {
          const dep = taskById.get(depId);
          if (dep) {
            if (isTaskPending(dep)) return true;
          }
        }
      }
      return false;
    });
  } else if (state.filter === 'no_due_date') {
    filtered = filtered.filter(task => !task.due_date && !isTaskArchived(task));
  }

  // Filter by category
  if (state.categoryFilter !== 'all') {
    filtered = filtered.filter(task => task.category === state.categoryFilter);
  }

  // Filter by search
  if (state.search) {
    const query = state.search.toLowerCase();
    filtered = filtered.filter(task =>
      task.text.toLowerCase().includes(query) ||
      (task.category || '').toLowerCase().includes(query)
    );
  }

  // Sort (simple sync version)
  const sorted = [...filtered];
  switch (state.sort) {
    case 'oldest':
      sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      break;
    case 'updated':
      sorted.sort((a, b) => {
        const dateA = a.updatedAt || a.createdAt;
        const dateB = b.updatedAt || b.createdAt;
        return new Date(dateB) - new Date(dateA);
      });
      break;
    case 'alpha':
      sorted.sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return sorted;
}

/**
 * Compute visible hierarchy from filtered tasks based on expansion state.
 * @param {Object[]} tasks - Filtered task list.
 * @param {Set<string|number>} expandedIds - Set of expanded task IDs.
 * @param {Object} state - Current dashboard state.
 * @returns {Object[]} Visible task array with __depth, __hasChildren, __isExpanded, __childStats.
 */
function computeVisibleHierarchy(tasks, expandedIds, state = null) {
  const taskMap = new Map();
  const childrenMap = new Map();
  const autoExpand = shouldAutoExpandHierarchy(state);

  tasks.forEach(task => {
    taskMap.set(task.id, task);
    const parentId = task.parent_task_id;
    if (parentId) {
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId).push(task);
    }
  });

  // Precompute child stats for each parent
  const childStatsMap = new Map();
  childrenMap.forEach((children, parentId) => {
    const completed = children.filter(c => isTaskCompleted(c) || isTaskArchived(c)).length;
    childStatsMap.set(parentId, { total: children.length, completed });
  });

  const visible = [];

  function traverse(taskId, depth) {
    const task = taskMap.get(taskId);
    if (!task) return;
    const isExpanded = autoExpand || expandedIds.has(taskId);

    const visibleTask = { ...task };
    visibleTask.__depth = depth;
    visibleTask.__hasChildren = childrenMap.has(taskId);
    visibleTask.__isExpanded = isExpanded;
    visibleTask.__childStats = childStatsMap.get(taskId) || null;

    visible.push(visibleTask);

    if (isExpanded && visibleTask.__hasChildren) {
      const children = childrenMap.get(taskId);
      children.forEach(child => traverse(child.id, depth + 1));
    }
  }

  // Find roots: tasks with no parent or parent not in current task set
  tasks.forEach(task => {
    if (!task.parent_task_id || !taskMap.has(task.parent_task_id)) {
      traverse(task.id, 0);
    }
  });

  return visible;
}

/**
 * Render worker results (async filtering done in worker)
 */
async function renderWorkerResults(result) {
  dom.taskList.innerHTML = '';
  
  if (result.length === 0) {
    dom.emptyState.style.display = 'block';
    return;
  }

  dom.emptyState.style.display = 'none';
  
  const fragment = document.createDocumentFragment();
  result.forEach(task => {
    const element = createTaskElement(task);
    fragment.appendChild(element);
  });
  
  dom.taskList.appendChild(fragment);
}

/**
 * Show task skeletons during loading
 */
function showTaskSkeletons(count = 8) {
  dom.emptyState.style.display = 'none';
  dom.taskList.innerHTML = '';
  const skeletons = skeletonLoader.createTaskSkeletons(count);
  dom.taskList.appendChild(skeletons);
}

/**
 * Create a task element (read mode) with memoization
 * If editing this task, returns an edit form element instead.
 */
function createTaskElement(task) {
  // If this task is being edited, return edit form
  if (editingId === task.id) {
    return createEditElement(task);
  }

  // Check if we have a recycled element
  let element = taskPool.pop();
  
  if (!element) {
    // Create new element
    const main = document.createElement('div');
    main.className = 'task-main';

    // Chevron for hierarchy toggle (hidden by default, shown if has children)
    const chevronBtn = document.createElement('button');
    chevronBtn.className = 'chevron-btn';
    chevronBtn.type = 'button';
    chevronBtn.textContent = '▶';
    chevronBtn.style.cssText = 'margin-right: 6px; background:none; border:none; cursor:pointer; padding:0; font-size:0.8em; color:var(--muted);';
    chevronBtn.aria_label = 'Toggle subtasks';
    // We'll attach click handler later after element is constructed

    const text = document.createElement('span');
    text.className = 'task-text';
    
    const meta = document.createElement('span');
    meta.className = 'task-meta';

    const category = document.createElement('span');
    category.className = 'category-badge';

    const projectBadge = document.createElement('span');
    projectBadge.className = 'project-chip';
    
    const dates = document.createElement('span');

    meta.append(category, projectBadge, dates);
    // Prepend chevron to main before text
    main.append(chevronBtn, text, meta);

    const description = document.createElement('div');
    description.className = 'task-description';

    const recurrenceBadge = document.createElement('span');
    recurrenceBadge.className = 'recurrence-badge';

    const modelBadge = document.createElement('span');
    modelBadge.className = 'model-chip';

    const runtimeBadge = document.createElement('span');
    runtimeBadge.className = 'runtime-chip';

    const sessionBadge = document.createElement('span');
    sessionBadge.className = 'session-badge';
    sessionBadge.style.cssText = 'margin-left:8px; font-size:0.85em; padding:2px 6px; border-radius:4px; background:var(--accent-3); color:var(--bg); cursor:pointer;';



    // Dependency badge (shows count of dependencies)
    const dependencyBadge = document.createElement('span');
    dependencyBadge.className = 'dependency-badge';
    dependencyBadge.style.cssText = 'margin-left:8px; font-size:0.85em; color:var(--accent-3);';

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const completeBtn = createActionButton('Done', 'complete-btn', null);
    const editBtn = createActionButton('Edit', 'edit-btn', null);
    const manageBtn = createActionButton('Archive', 'manage-btn', null); // Will toggle Archive/Restore
    const deleteBtn = createActionButton('Delete', 'delete-btn', null);

    const runOpenClawBtn = createActionButton('Run with OpenClaw', 'run-openclaw-btn', null);
    actions.append(completeBtn, editBtn, manageBtn, deleteBtn, runOpenClawBtn);

    const container = document.createElement('div');
    container.style.display = 'contents';
    container.append(main, actions);
    
    element = {
      container,
      main,
      chevronBtn,
      text,
      meta,
      category,
      projectBadge,
      dates,
      description,
      recurrenceBadge,
      modelBadge,
      runtimeBadge,
      sessionBadge,
      dependencyBadge,

      actions,
      completeBtn,
      editBtn,
      manageBtn,
      deleteBtn
    };
  }

  // Populate with task data
  element.text.textContent = task.text;
  element.category.textContent = task.category || 'General';
  element.dates.textContent = `Created ${formatDate(task.createdAt)}${task.updatedAt ? ` • Updated ${formatDate(task.updatedAt)}` : ''}`;

  // Reset meta content and re-add category and dates
  element.meta.innerHTML = '';
  element.meta.append(element.category);

  const activeProject = getProjectFromCatalog(latestStateSnapshot.project_id);
  if (task.project_name && (task.project_rollup || projectHasChildren(activeProject) || task.project_id !== latestStateSnapshot.project_id)) {
    element.projectBadge.textContent = task.project_name;
    element.projectBadge.title = task.project_path || task.project_name;
    element.meta.append(element.projectBadge);
  }

  element.meta.append(element.dates);

  if (task.description) {
    const trimmed = task.description.trim();
    if (trimmed) {
      const truncated = trimmed.length > 100 ? `${trimmed.slice(0, 100)}...` : trimmed;
      element.description.textContent = truncated;
      if (!element.description.isConnected) {
        element.main.appendChild(element.description);
      }
    } else if (element.description.isConnected) {
      element.description.remove();
    }
  } else if (element.description.isConnected) {
    element.description.remove();
  }

  const completed = isTaskCompleted(task);
  const archived = isTaskArchived(task);

  if (completed) {
    element.container.classList.add('completed');
    element.text.style.textDecoration = 'line-through';
    element.text.style.color = 'var(--muted)';
    element.completeBtn.setAttribute('aria-pressed', 'true');
  } else {
    element.container.classList.remove('completed');
    element.text.style.textDecoration = '';
    element.text.style.color = '';
    element.completeBtn.setAttribute('aria-pressed', 'false');
  }

  // Clear any previous priority/overdue classes
  element.container.classList.remove('priority-low','priority-medium','priority-high','priority-critical','overdue');

  // Apply priority class
  const priority = task.priority || 'medium';
  element.container.classList.add(`priority-${priority}`);

  // Apply overdue class if applicable (pending task with due date in the past)
  if (task.due_date && isTaskPending(task)) {
    const due = new Date(task.due_date);
    const now = new Date();
    if (due < now) {
      element.container.classList.add('overdue');
    }
  }

  // Add owner chip if task has an owner
  if (task.owner) {
    const ownerChip = createOwnerChip(task);
    element.meta.appendChild(ownerChip);
  }

  const preferredModel = getTaskPreferredModel(task);
  if (preferredModel) {
    element.modelBadge.textContent = `Model ${getModelChipLabel(preferredModel)}`;
    element.modelBadge.title = preferredModel;
    element.meta.appendChild(element.modelBadge);
  }

  const runtimeChip = getTaskRuntimeChip(task);
  if (runtimeChip) {
    element.runtimeBadge.textContent = runtimeChip.label;
    element.runtimeBadge.title = runtimeChip.title;
    element.meta.appendChild(element.runtimeBadge);
  }

  if (task.recurrence_rule && !completed && !archived) {
    element.recurrenceBadge.textContent = `🔄 ${task.recurrence_rule}`;
    element.meta.appendChild(element.recurrenceBadge);
  }

  // Hierarchical display: indentation, chevron, child progress
  const depth = task.__depth || 0;
  element.main.style.paddingLeft = `${depth * 20}px`; // 20px per level

  if (task.__hasChildren) {
    element.chevronBtn.style.display = 'inline-block';
    element.chevronBtn.textContent = task.__isExpanded ? '▼' : '▶';
    element.chevronBtn.onclick = (e) => {
      e.stopPropagation();
      toggleExpansion(task.id);
    };
  } else {
    element.chevronBtn.style.display = 'none';
  }

  // Child progress indicator (e.g., "2/5")
  if (task.__childStats) {
    const { total, completed } = task.__childStats;
    const progressSpan = document.createElement('span');
    progressSpan.className = 'child-progress';
    progressSpan.style.cssText = 'margin-left:8px; font-size:0.85em; color:var(--muted);';
    progressSpan.textContent = `${completed}/${total}`;
    element.meta.appendChild(progressSpan);
  }

  // Dependency badge (shows count of dependencies)
  if (task.dependency_ids && task.dependency_ids.length > 0) {
    element.dependencyBadge.textContent = `📎 ${task.dependency_ids.length}`;
    element.dependencyBadge.title = `${task.dependency_ids.length} dependency${task.dependency_ids.length>1?'s':''}`;
    element.meta.appendChild(element.dependencyBadge);
  }

  // Session badge (shows active workflow run with session binding)
  if (task.active_workflow_run_id && !completed && !archived) {
    fetchAndDisplaySession(task.active_workflow_run_id, element.sessionBadge);
  } else {
    // Clear badge if no active run
    element.sessionBadge.textContent = '';
  }

  // Update button event handlers
  element.completeBtn.onclick = () => handleToggleTask(task.id);
  element.editBtn.onclick = () => startEdit(task.id);
  element.deleteBtn.onclick = () => deleteTaskById(task.id);

  // Run with OpenClaw button
  element.runOpenClawBtn.onclick = (e) => {
    e.stopPropagation();
    openWorkflowLauncher(task);
  };

  // Configure manage button (archive/restore) based on task state
  if (archived) {
    element.manageBtn.textContent = 'Restore';
    element.manageBtn.onclick = () => restoreTaskById(task.id);
  } else {
    element.manageBtn.textContent = 'Archive';
    element.manageBtn.onclick = () => archiveTaskById(task.id);
  }

  // Return the container element (not the wrapper object)
  return element.container;
}

/**
 * Return a task element to the pool for recycling
 */
function recycleTaskElement(element) {
  if (element && element.parentNode) {
    element.remove();
  }
  // We could pool the element objects, but simpler to just re-create for now
  // For max performance, implement a proper element pool
}

/**
 * Fetch and display session information for active workflow run
 */
async function fetchAndDisplaySession(workflowRunId, badgeElement) {
  try {
    const response = await fetch(`/api/workflow-runs/${workflowRunId}`);
    if (!response.ok) {
      badgeElement.textContent = '';
      return;
    }

    const run = await response.json();

    // Map status to icon and label
    const statusMap = {
      'queued': { icon: '⏳', label: 'Queued' },
      'running': { icon: '▶️', label: 'Running' },
      'waiting_for_approval': { icon: '⛱️', label: 'Awaiting Approval' },
      'blocked': { icon: '⛔', label: 'Blocked' },
      'retrying': { icon: '🔄', label: 'Retrying' },
      'completed': { icon: '✅', label: 'Completed' },
      'failed': { icon: '❌', label: 'Failed' },
      'cancelled': { icon: '🚫', label: 'Cancelled' }
    };
    const statusInfo = statusMap[run.status] || { icon: '❓', label: run.status };
    const artifactCount = Number(run.actualArtifactCount ?? run.actual_artifact_count) || 0;

    // Build badge content
    let badgeText = '';
    let title = `Workflow: ${run.workflow_type}\nStatus: ${run.status}`;
    if (artifactCount > 0) {
      title += `\nArtifacts: ${artifactCount}`;
    }

    if (run.gateway_session_id && run.gateway_session_active) {
      // Active session bound
      const sessionIcon = '🤖';
      const stepInfo = run.current_step ? ` • ${run.current_step.replace(/_/g, ' ')}` : '';
      const artifactInfo = artifactCount > 0 ? ` • 📦 ${artifactCount}` : '';
      badgeText = `${sessionIcon} ${statusInfo.icon} ${statusInfo.label}${stepInfo}${artifactInfo}`;
      title += `\nSession: ${run.gateway_session_id} (active)`;
      // Pulse animation
      badgeElement.style.animation = 'pulse 2s infinite';
      badgeElement.style.cursor = 'pointer';
    } else if (run.status === 'running' || run.status === 'queued') {
      // Active but no session yet
      badgeText = `${statusInfo.icon} ${statusInfo.label}${artifactCount > 0 ? ` • 📦 ${artifactCount}` : ''}`;
      title += '\nNo active session';
      badgeElement.style.background = 'var(--muted)';
    } else {
      // Terminal states (completed, failed, cancelled) - show status without pulse
      badgeText = `${statusInfo.icon} ${statusInfo.label}${artifactCount > 0 ? ` • 📦 ${artifactCount}` : ''}`;
      badgeElement.style.background = '';
      badgeElement.style.animation = 'none';
    }

    badgeElement.textContent = badgeText;
    badgeElement.title = title;

    // Attach click handler to show details for any non-terminal state or if run has steps
    if (run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled') {
      badgeElement.onclick = () => showSessionDetails(workflowRunId);
    } else {
      badgeElement.onclick = null;
    }

  } catch (error) {
    console.error('[Session Badge] Failed to fetch workflow run:', error);
    badgeElement.textContent = '';
  }
}

/**
 * Show session details in a modal or panel
 */
async function showSessionDetails(workflowRunId) {
  try {
    const response = await fetch(`/api/workflow-runs/${workflowRunId}`);
    if (!response.ok) return;

    const run = await response.json();

    // Build timeline events
    const events = [];

    // Task creation (if available via task_id)
    if (run.task_id) {
      // Ideally we'd fetch task creation date, but for now we can estimate from run.created_at
      // We'll include run creation as the first event
      events.push({
        time: run.created_at,
        icon: '📝',
        label: 'Workflow run created',
        detail: `Type: ${run.workflow_type}`
      });
    }

    // Run started
    if (run.started_at) {
      events.push({
        time: run.started_at,
        icon: '▶️',
        label: 'Workflow started',
        detail: `Agent: ${run.owner_agent_id}`
      });
    }

    // Add step events
    if (run.steps && run.steps.length > 0) {
      run.steps.forEach(step => {
        if (step.started_at) {
          events.push({
            time: step.started_at,
            icon: step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏳',
            label: step.step_name.replace(/_/g, ' '),
            detail: `Status: ${step.status}${step.finished_at ? ', completed: ${formatDate(step.finished_at)}' : ''}`
          });
        }
      });
    }

    // Run completion or failure
    if (run.finished_at) {
      const icon = run.status === 'completed' ? '🏁' : run.status === 'failed' ? '💥' : '⏹️';
      events.push({
        time: run.finished_at,
        icon: icon,
        label: `Workflow ${run.status}`,
        detail: run.last_error ? `Error: ${run.last_error}` : ''
      });
    }

    const approvals = Array.isArray(run.approvals) ? run.approvals : [];
    approvals.forEach((approval) => {
      if (approval.requestedAt) {
        events.push({
          time: approval.requestedAt,
          icon: '🛂',
          label: `Approval requested: ${approval.stepName || approval.approvalType || 'review'}`,
          detail: `Approver: ${approval.approverId || 'unassigned'}${approval.dueAt ? `, due: ${formatTimestamp(approval.dueAt)}` : ''}`
        });
      }

      if (approval.escalatedAt) {
        events.push({
          time: approval.escalatedAt,
          icon: '📣',
          label: `Approval escalated: ${approval.stepName || approval.approvalType || 'review'}`,
          detail: `Escalated to: ${approval.escalatedTo || 'unassigned'}${approval.escalationReason ? `, reason: ${approval.escalationReason}` : ''}`
        });
      }

      if (approval.decidedAt) {
        const decisionIcon = approval.status === 'approved'
          ? '✅'
          : approval.status === 'rejected'
            ? '⛔'
            : '🚫';
        events.push({
          time: approval.decidedAt,
          icon: decisionIcon,
          label: `Approval ${approval.status || 'updated'}`,
          detail: `${approval.decidedBy || approval.approverId || 'system'}${approval.decision ? `, note: ${approval.decision}` : ''}`
        });
      }
    });

    // Sort events by time
    events.sort((a, b) => new Date(a.time) - new Date(b.time));

    const approvalSummary = run.approvalSummary || {};
    const approvalSummaryCards = [
      { label: 'Pending', value: approvalSummary.pending || 0 },
      { label: 'Overdue', value: approvalSummary.overdue || 0 },
      { label: 'Escalated', value: approvalSummary.escalated || 0 },
      { label: 'Artifact-linked', value: approvalSummary.artifactLinked || 0 }
    ];
    const approvalsHtml = approvals.length > 0
      ? `
        <div style="margin-bottom: 20px; padding: 12px; background: var(--bg-2); border-radius: 8px;">
          <h4 style="margin: 0 0 8px 0;">Approval Summary</h4>
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
            ${approvalSummaryCards.map((card) => `
              <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px 12px; min-width:120px;">
                <div style="font-size:1.2em; font-weight:700;">${card.value}</div>
                <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(card.label)}</div>
              </div>
            `).join('')}
          </div>
          <div style="display:grid; gap:8px;">
            ${approvals.map((approval) => `
              <div style="display:grid; gap:6px; padding:10px; border-radius:8px; background:var(--surface); border:1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; gap:8px; align-items:center; flex-wrap:wrap;">
                  <strong>${escapeHtml(approval.stepName || approval.approvalType || 'Approval')}</strong>
                  <span style="color:var(--muted); font-size:0.85em;">${escapeHtml(approval.statusInfo?.icon || '🛂')} ${escapeHtml(approval.statusInfo?.label || approval.status || 'Pending')}</span>
                </div>
                <div style="color:var(--muted); font-size:0.9em;">Type: ${escapeHtml((approval.approvalType || 'step_gate').replace(/_/g, ' '))} • Approver: ${escapeHtml(approval.approverId || 'unassigned')}</div>
                <div style="color:var(--muted); font-size:0.9em;">Requested by ${escapeHtml(approval.requestedBy || 'system')} • ${escapeHtml(formatTimestamp(approval.requestedAt))}${approval.dueAt ? ` • Due ${escapeHtml(formatTimestamp(approval.dueAt))}` : ''}</div>
                ${approval.artifact ? `
                  <div style="font-size:0.9em; word-break:break-word;">
                    Artifact: <a href="${escapeHtml(approval.artifact.uri || '#')}" target="_blank" rel="noreferrer">${escapeHtml(approval.artifact.label || approval.artifact.uri || 'Open artifact')}</a>
                  </div>
                ` : ''}
                ${approval.decision ? `<div style="font-size:0.9em;">Decision note: ${escapeHtml(approval.decision)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `
      : '';

    const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
    const artifactsHtml = artifacts.length > 0
      ? `
        <div style="margin-bottom: 20px; padding: 12px; background: var(--bg-2); border-radius: 8px;">
          <h4 style="margin: 0 0 8px 0;">Recorded Artifacts</h4>
          <div style="display:grid; gap:8px;">
            ${artifacts.map((artifact) => `
              <div style="display:grid; gap:2px; padding:10px; border-radius:8px; background:var(--surface); border:1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; gap:8px; align-items:center; flex-wrap:wrap;">
                  <strong>${escapeHtml(artifact.label || artifact.artifact_type || 'Artifact')}</strong>
                  <span style="color:var(--muted); font-size:0.85em;">${escapeHtml((artifact.status || 'generated').replace(/_/g, ' '))}</span>
                </div>
                <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(artifact.artifact_type || 'output')} ${artifact.created_by ? `• ${escapeHtml(artifact.created_by)}` : ''}</div>
                <div style="font-size:0.9em; word-break:break-word;">
                  <a href="${escapeHtml(artifact.uri || '#')}" target="_blank" rel="noreferrer">${escapeHtml(artifact.uri || 'Open artifact')}</a>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `
      : '';

    const governancePolicies = Array.isArray(run.governance?.actionPolicy) ? run.governance.actionPolicy : [];
    const governanceHtml = `
      <div style="margin-bottom: 20px; padding: 12px; background: var(--bg-2); border-radius: 8px;">
        <h4 style="margin: 0 0 8px 0;">Governance & Runbook</h4>
        <div style="color: var(--muted); font-size: 0.92em; margin-bottom: 10px;">
          Runbook: ${run.governance?.runbookRef ? `<a href="/api/runbook/${encodeURIComponent(run.governance.runbookRef)}" target="_blank" rel="noreferrer">${escapeHtml(run.governance.runbookRef)}</a>` : 'No runbook linked'}
        </div>
        ${governancePolicies.length ? `
          <div style="display:grid; gap:8px;">
            ${governancePolicies.map((policy) => `
              <div style="padding:10px; border-radius:8px; background:var(--surface); border:1px solid var(--border);">
                <div style="font-weight:700;">${escapeHtml(policy.label)}</div>
                <div style="color:var(--muted); font-size:0.9em;">Roles: ${escapeHtml((policy.roles || []).join(', ') || 'operator')}</div>
                ${policy.capabilities?.length ? `<div style="color:var(--muted); font-size:0.9em;">Capabilities: ${escapeHtml(policy.capabilities.join(', '))}</div>` : ''}
              </div>
            `).join('')}
          </div>
        ` : `<div style="color:var(--muted); font-size:0.92em;">No governance policy metadata is attached to this run yet.</div>`}
      </div>
    `;

    // Build timeline HTML
    const timelineHtml = events.map((ev, idx) => `
      <div class="timeline-event" style="display: flex; gap: 12px; margin-bottom: 12px; position: relative;">
        <div style="flex-shrink: 0; width: 24px; text-align: center; font-size: 1.1em;">${ev.icon}</div>
        <div style="flex-grow: 1;">
          <div style="font-weight: 600; margin-bottom: 2px;">${ev.label}</div>
          <div style="color: var(--muted); font-size: 0.9em;">
            ${formatDate(ev.time)}${ev.detail ? ` • ${ev.detail}` : ''}
          </div>
        </div>
      </div>
    `).join('');

    // Modal container
    const modal = document.createElement('div');
    modal.className = 'session-modal';
    modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      max-width: 640px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: var(--shadow);
      z-index: 10000;
    `;

    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0;">Workflow Timeline</h3>
        <button onclick="this.closest('.session-modal').remove()" style="background:none;border:none;font-size:1.5em;cursor:pointer;color:var(--muted);">&times;</button>
      </div>
      <div style="margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border);">
        <p style="margin: 4px 0;"><strong>Workflow:</strong> ${run.workflow_type}</p>
        <p style="margin: 4px 0;"><strong>Status:</strong> ${run.status}</p>
        <p style="margin: 4px 0;"><strong>Session:</strong> ${run.gateway_session_id || 'None'} ${run.gateway_session_active ? '(active)' : ''}</p>
        <p style="margin: 4px 0;"><strong>Owner:</strong> ${run.owner_agent_id}</p>
        <p style="margin: 4px 0;"><strong>Artifacts:</strong> ${Number(run.actualArtifactCount ?? run.actual_artifact_count) || 0} / ${Number(run.expectedArtifactCount ?? run.expected_artifact_count) || 0}</p>
        ${run.current_step ? `<p style="margin: 4px 0;"><strong>Current Step:</strong> ${run.current_step.replace(/_/g, ' ')}</p>` : ''}
      </div>

      ${run.output_summary && Object.keys(run.output_summary).length > 0 ? `
        <div style="margin-bottom: 20px; padding: 12px; background: var(--bg-2); border-radius: 8px;">
          <h4 style="margin: 0 0 8px 0;">Artifacts & Outputs</h4>
          <dl style="margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 12px;">
            ${Object.entries(run.output_summary).map(([key, value]) => `
              <dt style="font-weight: 600; color: var(--text);">${key.replace(/_/g, ' ')}</dt>
              <dd style="margin: 0; color: var(--muted); word-break: break-word;">${typeof value === 'object' ? JSON.stringify(value) : value}</dd>
            `).join('')}
          </dl>
        </div>
      ` : ''}

      ${approvalsHtml}

      ${artifactsHtml}

      ${governanceHtml}

      <h4 style="margin-top:0;">Execution History</h4>
      ${events.length > 0 ? timelineHtml : '<p style="color: var(--muted);">No events recorded</p>'}
    `;

    // Close on background click
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };

    document.body.appendChild(modal);
  } catch (error) {
    console.error('[Session Modal] Failed to show timeline:', error);
  }
}


/**
 * Launch workflow launcher modal for a task
 */
async function openWorkflowLauncher(task) {
  // Fetch available workflow templates
  try {
    const response = await fetch('/api/workflow-templates');
    if (!response.ok) throw new Error('Failed to fetch workflow templates');

    const data = await response.json();
    const templates = data.templates || [];

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'workflow-launcher-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    `;

    const panel = document.createElement('div');
    panel.className = 'workflow-launcher-panel';
    panel.style.cssText = `
      background: var(--surface);
      border-radius: 12px;
      max-width: 600px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: var(--shadow);
    `;

    const title = document.createElement('h2');
    title.textContent = 'Run with OpenClaw';
    title.style.cssText = 'margin: 0 0 8px 0; padding: 24px 24px 0 24px;';

    const subtitle = document.createElement('p');
    subtitle.textContent = `Task: ${task.text}`;
    subtitle.style.cssText = 'color: var(--muted); margin: 0 0 20px 0; padding: 0 24px;';

    const templateList = document.createElement('div');
    templateList.style.cssText = 'padding: 0 24px 24px;';

    if (templates.length === 0) {
      templateList.innerHTML = '<p style="color: var(--muted);">No workflow templates available.</p>';
    } else {
      templateList.innerHTML = templates.map(t => `
        <div class="workflow-template-item" data-template="${t.name}" style="
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          cursor: pointer;
          transition: all 0.2s;
        " onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
          <div style="font-weight: 600; margin-bottom: 8px;">${t.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
          <div style="color: var(--muted); font-size: 0.9em; margin-bottom: 8px;">${t.description || 'No description'}</div>
          <div style="display: flex; gap: 12px; font-size: 0.85em; color: var(--muted);">
            <span>Category: ${t.category}</span>
            <span>Steps: ${t.steps ? t.steps.length : 0}</span>
            ${t.estimated_duration ? `<span>Est: ${t.estimated_duration}</span>` : ''}
          </div>
          <div style="margin-top:8px; font-size:0.85em; color:var(--muted);">
            Runbook: ${t.runbookRef ? escapeHtml(t.runbookRef) : 'Not linked'}${Array.isArray(t.governance?.actionPolicy) && t.governance.actionPolicy.length ? ` • Policy: ${escapeHtml(t.governance.actionPolicy.map((policy) => policy.label).slice(0, 3).join(', '))}` : ''}
          </div>
        </div>
      `).join('');

      // Add click handlers for template selection
      templateList.querySelectorAll('.workflow-template-item').forEach(item => {
        item.onclick = () => {
          const templateName = item.dataset.template;
          modal.remove();
          launchWorkflow(task, templateName);
        };
      });
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';
    cancelBtn.style.cssText = 'position: absolute; top: 24px; right: 24px; background: none; border: none; font-size: 1.5em; cursor: pointer; color: var(--muted);';
    cancelBtn.onclick = () => modal.remove();

    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(templateList);
    panel.appendChild(cancelBtn);
    modal.appendChild(panel);

    // Close on background click
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };

    document.body.appendChild(modal);

    // Focus first template item
    setTimeout(() => {
      const first = templateList.querySelector('.workflow-template-item');
      if (first) first.focus();
    }, 100);

  } catch (error) {
    console.error('[Workflow Launcher] Failed:', error);
    alert('Failed to load workflow templates. Please try again.');
  }
}

/**
 * Launch a workflow for a task with selected template
 */
async function launchWorkflow(task, workflowType) {
  try {
    // Create workflow run with session binding
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const createResponse = await fetch('/api/workflow-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_type: workflowType,
        owner_agent_id: getTaskOwnerAgent(task), // Determine appropriate agent
        actor: 'dashboard-operator',
        board_id: task.project_id || null,
        task_id: task.id,
        initiator: 'user',
        input_payload: {
          task_id: task.id,
          task_text: task.text,
          task_description: task.description,
          task_category: task.category,
          ...task.metadata || {}
        },
        gateway_session_id: sessionId
      })
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create workflow run: ${createResponse.status}`);
    }

    const run = await createResponse.json();

    // Bind session to run
    await fetch(`/api/workflow-runs/${run.id}/bind-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });

    // Start the workflow
    await fetch(`/api/workflow-runs/${run.id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    // Show success notification
    showSnackbar(`Started ${workflowType} workflow for task`, 5000);

    // Refresh task list to show session badge
    fetchLatestState();

  } catch (error) {
    console.error('[Workflow Launch] Failed:', error);
    alert(`Failed to launch workflow: ${error.message}`);
  }
}

/**
 * Get appropriate agent ID for a task based on category or task properties
 */
function getTaskOwnerAgent(task) {
  // Simple routing logic - can be enhanced
  const category = task.category ? task.category.toLowerCase() : 'general';

  if (category.includes('affiliate') || category.includes('content') || category.includes('blog')) {
    return 'affiliate-editorial';
  }
  if (category.includes('image') || category.includes(' graphic')) {
    return 'image-generator';
  }
  if (category.includes('publish') || category.includes('wordpress') || category.includes('wp')) {
    return 'wordpress-publisher';
  }
  if (category.includes('site') || category.includes('fix') || category.includes('bug')) {
    return 'site-fixer';
  }
  if (category.includes('incident') || category.includes('investigation')) {
    return 'incident-investigator';
  }
  if (category.includes('code') || category.includes('development') || category.includes('programming')) {
    return 'coder';
  }
  if (category.includes('review') || category.includes('quality') || category.includes('qa')) {
    return 'qa-reviewer';
  }

  // Default agent (could be configured)
  return 'main-agent';
}

/**
 * Show a snackbar notification
 */
function showSnackbar(message, duration = 3000) {
  const snackbar = document.getElementById('snackbar');
  const messageEl = document.getElementById('snackbarMessage');

  if (snackbar && messageEl) {
    messageEl.textContent = message;
    snackbar.style.display = 'flex';
    snackbar.style.animation = 'slideIn 0.3s ease-out';

    setTimeout(() => {
      snackbar.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => snackbar.style.display = 'none', 300);
    }, duration);
  } else {
    // Fallback to alert if snackbar not available
    console.log('[Snackbar]', message);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/**
 * Create an action button
 */
function createActionButton(text, className, onClick, ariaPressed = false) {
  const btn = document.createElement('button');
  btn.className = `action-btn ${className}`;
  btn.type = 'button';
  btn.textContent = text;
  btn.setAttribute('aria-pressed', ariaPressed);
  btn.dataset.action = className.split('-')[0];
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Render view with skeleton loading
 */
async function renderViewSwitch(view, state) {
  currentView = view;
  
  // Clean up any existing specialized views
  if (virtualScroller) {
    virtualScroller.destroy();
    virtualScroller = null;
    isVirtualScrolling = false;
  }
  if (window.timelineViewInstance) {
    window.timelineViewInstance.destroy();
    window.timelineViewInstance = null;
  }
  if (cronViewInstance) {
    clearInterval(cronViewInstance.refreshTimer);
    if (cronViewInstance.container) cronViewInstance.container.innerHTML = '';
    cronViewInstance = null;
  }
  if (boardViewInstance) {
    boardViewInstance.destroy?.();
    boardViewInstance = null;
  }
  if (agentViewInstance) {
    agentViewInstance.destroy();
    agentViewInstance = null;
  }
  if (auditViewInstance) {
    auditViewInstance.destroy();
    auditViewInstance = null;
  }
  
  // Reset task list styles
  dom.taskList.style = '';
  dom.taskList.innerHTML = '';
  
  if (view === 'list') {
    // Render tasks (with virtual scrolling if needed)
    await renderTasksWithSkeleton(state);
  } else if (view === 'timeline') {
    // Initialize timeline view with lazy loading
    await renderTimelineView(state);
  } else if (view === 'cron') {
    // Initialize cron view
    await renderCronView(state);
  } else if (view === 'board') {
    // Initialize board view with lazy loading
    await renderBoardView(state);
  } else if (view === 'agent') {
    // Initialize agent view with lazy loading
    if (!AgentViewClass) {
      try {
        const module = await import('./agent-view.mjs');
        AgentViewClass = module.AgentView || module.default;
      } catch (error) {
        console.error('[Dashboard] Failed to load agent view:', error);
        showNotice('Agent view unavailable. Showing list view.', 'error');
        await renderTasksWithSkeleton(state);
        return;
      }
    }
    try {
      agentViewInstance = new AgentViewClass(dom.taskList, {
        showNotice: showNotice,
        onAgentChange: (agent) => {
          currentAgent = agent;
          // Refresh task list to reflect 'my_tasks' filter if active
          if (currentView === 'list') {
            renderTasksDebounced();
          }
        }
      });
      await agentViewInstance.load();
      console.log('[Dashboard] Agent view initialized');
    } catch (error) {
      console.error('[Dashboard] Agent view rendering failed:', error);
      showNotice('Failed to render agent view. Showing list view.', 'error');
      await renderTasksWithSkeleton(state);
    }
  } else if (view === 'departments') {
    await renderDepartmentOpsView(state);
  } else if (view === 'service-requests') {
    await renderServiceRequestsView(state);
  } else if (view === 'approvals') {
    await renderApprovalsView(state);
  } else if (view === 'artifacts') {
    await renderArtifactsView(state);
  } else if (view === 'dependencies') {
    await renderCrossBoardDepsView(state);
  } else if (view === 'health') {
    await renderHealthView(state);
  } else if (view === 'metrics') {
    await renderMetricsView(state);
  } else if (view === 'runbooks') {
    await renderRunbooksView(state);
  } else if (view === 'memory') {
  } else if (view === 'memory') {
  } else if (view === 'memory') {
  } else if (view === 'publish') {
    await renderPublishView(state);
  } else if (view === 'memory') {
    await renderMemorySummaryView(state);
  } else if (view === 'handoffs') {
    await renderLeadHandoffsView(state);
  } else if (view === 'audit') {
  } else if (view === 'audit') {
    try {
      if (!auditViewInstance) {
        auditViewInstance = new AuditView(dom.taskList, { limit: 50 });
      }
      await auditViewInstance.load();
      console.log('[Dashboard] Audit view initialized');
    } catch (error) {
      console.error('[Dashboard] Audit view rendering failed:', error);
      showNotice('Failed to render audit view. Showing list view.', 'error');
      await renderTasksWithSkeleton(state);
    }
  } else {
    // Other views (audit) - use list view as fallback
    console.log(`[Dashboard] View '${view}' not fully implemented, showing list view`);
    await renderTasksWithSkeleton(state);
  }
  
  updateViewButtons(state);
}

/**
 * Update stats display (optimized to batch DOM updates)
 */
async function updateStats(state) {
  const total = state.tasks.length;
  const completed = state.tasks.filter(t => isTaskCompleted(t)).length;
  const pending = state.tasks.filter(t => isTaskPending(t)).length;
  const archived = state.tasks.filter(t => isTaskArchived(t)).length;

  // Batch update
  dom.totalTasks.textContent = total;
  dom.completedTasks.textContent = completed;
  dom.pendingTasks.textContent = pending;
  dom.archivedTasks.textContent = archived;

  dom.filterAllCount.textContent = total;
  dom.filterPendingCount.textContent = pending;
  dom.filterCompletedCount.textContent = completed;
  dom.filterArchivedCount.textContent = archived;
}

/**
 * Update filter buttons state
 */
function updateFilterButtons(state) {
  dom.filterButtons.forEach(button => {
    const isActive = button.dataset.filter === state.filter;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

/**
 * Update search and sort UI to match state
 */
function updateSearchSortUI(state) {
  dom.searchInput.value = state.search || '';
  dom.sortSelect.value = state.sort || 'newest';
}

/**
 * Update theme UI
 */
function updateThemeUI(state) {
  document.documentElement.setAttribute('data-theme', state.theme);
  const isDark = state.theme === 'dark';
  dom.themeIcon.textContent = isDark ? '☀️' : '🌙';
  dom.themeLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
  dom.themeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
}

/**
 * Update view buttons state
 */
async function renderDepartmentOpsView(state) {
  dom.taskList.innerHTML = '';

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
  dom.taskList.appendChild(container);

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
        if (runId) {
          showSessionDetails(runId);
        }
      });
    });

    bodyEl.querySelectorAll('[data-department-switch-view]').forEach((button) => {
      button.addEventListener('click', async () => {
        const targetView = button.getAttribute('data-department-switch-view');
        if (targetView) {
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

    const response = await fetch(`/api/org/departments/${encodeURIComponent(selectedDepartmentId)}/operating-view`, {
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

    const departmentsRes = await fetch('/api/org/departments', { headers: { Accept: 'application/json' } });
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

async function renderServiceRequestsView(state) {
  dom.taskList.innerHTML = '';

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
  dom.taskList.appendChild(container);

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

  const currentProjectId = state?.project_id || getStateSync().project_id || '';
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
          const response = await fetch(`/api/service-requests/${requestId}/route`, {
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
          const response = await fetch(`/api/service-requests/${requestId}/launch`, {
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
      fetch('/api/services', { headers: { Accept: 'application/json' } }),
      fetch(`/api/service-requests?limit=200${currentProjectId ? `&project_id=${encodeURIComponent(currentProjectId)}` : ''}`, { headers: { Accept: 'application/json' } }),
      fetch('/api/org/departments', { headers: { Accept: 'application/json' } }),
      fetch('/api/org/agents', { headers: { Accept: 'application/json' } }),
      fetch('/api/workflow-templates', { headers: { Accept: 'application/json' } })
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
      const response = await fetch('/api/service-requests', {
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

async function renderApprovalsView(state) {
  dom.taskList.innerHTML = '';

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
  dom.taskList.appendChild(container);

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
        if (runId) {
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
          const response = await fetch(`/api/approvals/${approvalId}`, {
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
          const response = await fetch(`/api/approvals/${approvalId}`, {
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
          const response = await fetch(`/api/approvals/${approvalId}/escalate`, {
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
    const response = await fetch('/api/approvals/pending', { headers: { Accept: 'application/json' } });
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

/**
 * Render Artifacts view
 * Shows workflow artifacts with business filters and traceability back to runs/tasks.
 */
async function renderArtifactsView(state) {
  dom.taskList.innerHTML = '';

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
  dom.taskList.appendChild(container);

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
        if (runId) {
          showSessionDetails(runId);
        }
      });
    });
  }

  async function loadArtifacts() {
    const response = await fetch('/api/artifacts?limit=250', { headers: { Accept: 'application/json' } });
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

/**
 * Render Publish Center view
 * Shows tasks with active workflow runs, grouped by workflow step
 */
async function renderPublishView(state) {
  // Set up view container
  dom.taskList.innerHTML = '';

  const container = document.createElement('div');
  container.style.cssText = 'padding: 16px;';

  // Header
  const header = document.createElement('div');
  header.innerHTML = '<h2 style="margin:0 0 16px 0;">📤 Publish Center</h2>';
  container.appendChild(header);

  // Summary
  const summary = document.createElement('div');
  summary.style.cssText = 'display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap;';
  container.appendChild(summary);

  // Tasks container
  const tasksContainer = document.createElement('div');
  tasksContainer.id = 'publish-tasks';
  container.appendChild(tasksContainer);

  dom.taskList.appendChild(container);

  // Fetch tasks
  try {
    const response = await fetch('/api/tasks/all');
    if (!response.ok) throw new Error('Failed to fetch tasks');

    const data = await response.json();
    let tasks = data.tasks || data;

    // Filter tasks with active workflow runs
    tasks = tasks.filter(t => t.active_workflow_run_id);

    if (tasks.length === 0) {
      tasksContainer.innerHTML = '<p style="color:var(--muted);">No tasks with active workflow runs.</p>';
      return;
    }

    // Fetch workflow run details
    const runs = await Promise.all(
      tasks.map(t => fetch(`/api/workflow-runs/${t.active_workflow_run_id}`).then(r => r.ok ? r.json() : null).catch(() => null))
    );

    const taskRuns = tasks.map((task, idx) => ({ task, run: runs[idx] })).filter(tr => tr.run);

    // Summary counts by status
    const statusCounts = {};
    let totalArtifacts = 0;
    taskRuns.forEach(tr => {
      const s = tr.run.status;
      statusCounts[s] = (statusCounts[s] || 0) + 1;
      totalArtifacts += Number(tr.run.actualArtifactCount ?? tr.run.actual_artifact_count) || 0;
    });

    // Render summary
    summary.innerHTML = Object.entries(statusCounts).map(([status, count]) => {
      const emoji = status === 'running' ? '▶️' : status === 'queued' ? '⏳' : status === 'completed' ? '✅' : status === 'failed' ? '❌' : '⚪';
      return `<div style="padding: 8px 12px; background: var(--bg-2); border-radius: 6px;"><strong>${emoji} ${status}</strong>: ${count}</div>`;
    }).join('') + `<div style="padding: 8px 12px; background: var(--bg-2); border-radius: 6px;"><strong>📦 artifacts</strong>: ${totalArtifacts}</div>`;

    // Table
    const table = document.createElement('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse; background: var(--surface);';
    table.innerHTML = `
      <thead>
        <tr style="border-bottom: 2px solid var(--border); background: var(--bg-2);">
          <th style="text-align:left; padding: 10px;">Task</th>
          <th style="text-align:left; padding: 10px;">Workflow</th>
          <th style="text-align:left; padding: 10px;">Current Step</th>
          <th style="text-align:left; padding: 10px;">Status</th>
          <th style="text-align:left; padding: 10px;">Artifacts</th>
          <th style="text-align:left; padding: 10px;">Agent</th>
          <th style="text-align:left; padding: 10px;">Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    taskRuns.forEach(tr => {
      const trEl = document.createElement('tr');
      trEl.style.cssText = 'border-bottom: 1px solid var(--border);';
      trEl.innerHTML = `
        <td style="padding: 10px;"><a href="#" onclick="switchView('board'); return false;" title="Go to task">${tr.task.title}</a></td>
        <td style="padding: 10px;">${tr.run.workflow_type}</td>
        <td style="padding: 10px;">${tr.run.current_step ? tr.run.current_step.replace(/_/g, ' ') : '—'}</td>
        <td style="padding: 10px;">${tr.run.status}</td>
        <td style="padding: 10px;">${Number(tr.run.actualArtifactCount ?? tr.run.actual_artifact_count) || 0} / ${Number(tr.run.expectedArtifactCount ?? tr.run.expected_artifact_count) || 0}</td>
        <td style="padding: 10px;">${tr.run.owner_agent_id}</td>
        <td style="padding: 10px;">
          <button class="secondary-btn" style="font-size:0.85em; padding:4px 8px;" onclick="showSessionDetails('${tr.run.id}')">Details</button>
          ${tr.run.status === 'completed' && !tr.run.output_summary?.verified ? `
            <button class="secondary-btn" style="font-size:0.85em; padding:4px 8px; background:var(--accent); color:var(--bg);" onclick="openVerificationModal('${tr.run.id}', '${tr.task.title.replace(/'/g, "\'")}')">Verify</button>
          ` : ''}
          ${tr.run.output_summary?.verified ? '✅ Verified' : ''}
        </td>
      `;
      tbody.appendChild(trEl);
    });

    tasksContainer.appendChild(table);

  } catch (err) {
    console.error('[Publish Center] Error:', err);
    tasksContainer.innerHTML = '<p style="color:var(--accent-3);">Failed to load publish data.</p>';
  }
}

/**
 * Render Group Memory Summary view
 */
async function renderMemorySummaryView(state) {
  dom.taskList.innerHTML = '';
  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = '<h2>📚 Board Memory Summary</h2><div id="memory-summary-content">Loading...</div>';
  dom.taskList.appendChild(container);

  const contentDiv = container.querySelector('#memory-summary-content');
  const projectId = state.project || getCurrentProjectId(); // helper to get current project

  try {
    const resp = await fetch(`/api/board-memory-summary?project_id=${projectId}`);
    if (!resp.ok) throw new Error('Failed to fetch memory summary');
    const data = await resp.json();
    const { summary } = data;

    if (!summary || summary.total_entries === 0) {
      contentDiv.innerHTML = '<p>No memory activity found for this board.</p>';
      return;
    }

    // Build HTML
    let html = `
      <div style="display:flex; gap:16px; margin-bottom:16px; flex-wrap:wrap;">
        <div class="stat-card" style="background:var(--bg-2); padding:12px; border-radius:8px; min-width:120px;">
          <div style="font-size:1.5em; font-weight:600;">${summary.total_entries}</div>
          <div style="color:var(--muted);">Total entries</div>
        </div>
        <div class="stat-card" style="background:var(--bg-2); padding:12px; border-radius:8px; min-width:120px;">
          <div style="font-size:1.5em; font-weight:600;">${summary.recent_24h}</div>
          <div style="color:var(--muted);">Last 24h</div>
        </div>
      </div>
      <h3>Recent Activity</h3>
      <ul style="list-style:none; padding:0;">
    `;

    for (const entry of summary.recent_entries) {
      const time = new Date(entry.timestamp).toLocaleString();
      html += `
        <li style="padding:8px; border-bottom:1px solid var(--border);">
          <div style="font-weight:600;">${entry.action} by ${entry.actor}</div>
          <div style="color:var(--muted); font-size:0.9em;">${time} on task: ${entry.task_title}</div>
        </li>
      `;
    }

    html += '</ul>';
    contentDiv.innerHTML = html;

  } catch (err) {
    console.error('[Memory Summary]', err);
    contentDiv.innerHTML = '<p style="color:var(--accent-3);">Error loading memory summary.</p>';
  }
}

/**
 * Render Lead Handoffs view
 */
async function renderLeadHandoffsView(state) {
  dom.taskList.innerHTML = '';
  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = '<h2>🤝 Lead Handoffs</h2><div id="handoffs-content">Loading...</div>';
  dom.taskList.appendChild(container);

  const contentDiv = container.querySelector('#handoffs-content');
  const projectId = state.project || getCurrentProjectId();

  try {
    const resp = await fetch(`/api/lead-handoffs?project_id=${projectId}`);
    if (!resp.ok) throw new Error('Failed to fetch handoffs');
    const data = await resp.json();
    const { handoffs } = data;

    if (!handoffs || handoffs.length === 0) {
      contentDiv.innerHTML = '<p>No handoff activity found for this board.</p>';
      return;
    }

    let html = '<table style="width:100%; border-collapse:collapse;"><thead><tr style="background:var(--bg-2);"><th style="padding:8px; text-align:left;">Task</th><th>Action</th><th>Actor</th><th>Old Owner</th><th>New Owner</th><th>Time</th></tr></thead><tbody>';

    for (const h of handoffs) {
      const time = new Date(h.timestamp).toLocaleString();
      html += `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px;">${h.task_title}</td>
          <td style="padding:8px;">${h.action}</td>
          <td style="padding:8px;">${h.actor}</td>
          <td style="padding:8px;">${h.old_owner || '-'}</td>
          <td style="padding:8px;">${h.new_owner || '-'}</td>
          <td style="padding:8px;">${time}</td>
        </tr>
      `;
    }
    html += '</tbody></table>';
    contentDiv.innerHTML = html;

  } catch (err) {
    console.error('[Lead Handoffs]', err);
    contentDiv.innerHTML = '<p style="color:var(--accent-3);">Error loading handoffs.</p>';
  }
}

/**
 * Render Cross-Board Dependencies view
 */
async function renderCrossBoardDepsView(state) {
  dom.taskList.innerHTML = '';
  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = '<h2>🔗 Cross-Board Dependencies</h2><p>Tasks that depend on tasks from other boards/projects.</p><div id="deps-content">Loading...</div>';
  dom.taskList.appendChild(container);

  const contentDiv = container.querySelector('#deps-content');
  try {
    const resp = await fetch('/api/cross-board-dependencies');
    if (!resp.ok) throw new Error('Failed to fetch cross-board dependencies');
    const data = await resp.json();
    const deps = data.cross_board_dependencies || [];

    if (deps.length === 0) {
      contentDiv.innerHTML = '<p>No cross-board dependencies found.</p>';
      return;
    }

    let html = '<table style="width:100%; border-collapse:collapse;"><thead><tr style="background:var(--bg-2);"><th>Task</th><th>Project</th><th>Dep Count</th><th>Cross-board</th></tr></thead><tbody>';
    for (const d of deps) {
      html += `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px;">${d.task_title}</td>
          <td style="padding:8px;">${d.project_id.substring(0,8)}...</td>
          <td style="padding:8px;">${d.dependency_count}</td>
          <td style="padding:8px;">${d.cross_board_count}</td>
        </tr>
      `;
    }
    html += '</tbody></table>';
    contentDiv.innerHTML = html;

  } catch (err) {
    console.error('[CrossBoardDepsView]', err);
    contentDiv.innerHTML = '<p style="color:var(--accent-3);">Error loading cross-board dependencies.</p>';
  }
}

/**
 * Render Service Health view
 */
async function renderHealthView(state) {
  dom.taskList.innerHTML = '';
  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = '<h2>❤️ Service Health</h2><div id="health-content">Loading...</div>';
  dom.taskList.appendChild(container);

  const contentDiv = container.querySelector('#health-content');
  try {
    const resp = await fetch('/api/health-status');
    if (!resp.ok) throw new Error('Failed to fetch health status');
    const data = await resp.json();
    
    const statusColor = data.status === 'ok' ? 'green' : data.status === 'degraded' ? 'orange' : 'red';
    let html = `
      <div style="margin-bottom:16px;">
        <strong>Overall Status:</strong> <span style="color:${statusColor}; font-weight:600;">${data.status.toUpperCase()}</span>
        <span style="color:var(--muted); font-size:0.9em;"> (checked ${new Date(data.timestamp).toLocaleTimeString()})</span>
      </div>
      <h3>Checks</h3>
      <table style="width:100%; border-collapse:collapse;">
        <thead><tr style="background:var(--bg-2);"><th>Service</th><th>Status</th><th>Details</th></tr></thead>
        <tbody>
    `;
    
    for (const [name, check] of Object.entries(data.checks)) {
      const healthy = check.healthy !== false;
      const status = healthy ? '✅' : '❌';
      const detail = check.latency_ms ? `Latency: ${check.latency_ms}ms` : check.note || (check.count !== undefined ? `Count: ${check.count}` : '');
      html += `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px; font-weight:600;">${name}</td>
          <td style="padding:8px;">${status} ${healthy ? 'Healthy' : 'Unhealthy'}</td>
          <td style="padding:8px; color:var(--muted);">${detail}</td>
        </tr>
      `;
    }
    html += '</tbody></table>';
    contentDiv.innerHTML = html;
    
    // Auto-refresh every 30 seconds
    if (window.healthRefreshTimer) clearInterval(window.healthRefreshTimer);
    window.healthRefreshTimer = setInterval(() => {
      renderHealthView(state);
    }, 30000);

  } catch (err) {
    console.error('[Health]', err);
    contentDiv.innerHTML = '<p style="color:var(--accent-3);">Error loading health status.</p>';
  }
}

/**
 * Render Metrics Dashboard view
 */
async function renderMetricsView(state) {
  dom.taskList.innerHTML = '';
  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:16px;">
      <div>
        <h2 style="margin:0 0 6px 0;">📊 Metrics Dashboard</h2>
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
  dom.taskList.appendChild(container);

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
        ` : `<p style="margin:0; color:var(--muted);">No daily department snapshots are available yet for this range. Run the metrics aggregation job to populate trend history.</p>`}
      </section>
    `;
  }

  async function loadMetrics() {
    const from = fromInput.value || dateToInputValue(new Date(Date.now() - (29 * 24 * 60 * 60 * 1000)));
    const to = toInput.value || dateToInputValue(new Date());
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const [orgRes, departmentsRes, agentsRes, servicesRes, sitesRes] = await Promise.all([
      fetch(`/api/metrics/org?${query}`, { headers: { Accept: 'application/json' } }),
      fetch(`/api/metrics/departments?${query}`, { headers: { Accept: 'application/json' } }),
      fetch(`/api/metrics/agents?${query}`, { headers: { Accept: 'application/json' } }),
      fetch(`/api/metrics/services?${query}`, { headers: { Accept: 'application/json' } }),
      fetch(`/api/metrics/sites?${query}`, { headers: { Accept: 'application/json' } })
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
      const detailRes = await fetch(`/api/metrics/departments/${encodeURIComponent(selectedDepartmentId)}?${query}`, {
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
          { label: 'Workflow Runs Started', value: scorecard.workflowRunsStarted || 0, detail: `${scorecard.workflowRunsCompleted || 0} completed · ${scorecard.workflowRunsFailed || 0} failed` },
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
  } catch (err) {
    console.error('[Metrics]', err);
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

/**
 * Render Runbooks view
 */
async function renderRunbooksView(state) {
  dom.taskList.innerHTML = '';
  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = '<h2>📖 Runbooks</h2><div id="runbooks-content">Loading runbooks...</div>';
  dom.taskList.appendChild(container);
  const contentDiv = container.querySelector('#runbooks-content');

  try {
    // List runbook files by fetching directory listing or we can have an index API.
    // For now, we know the names from workflow templates. Let's fetch that list from /api/workflow-templates.
    const templatesRes = await fetch('/api/workflow-templates');
    if (!templatesRes.ok) throw new Error('Failed to fetch workflow templates');
    const templatesData = await templatesRes.json();
    const templates = templatesData.templates || [];

    if (templates.length === 0) {
      contentDiv.innerHTML = '<p>No runbooks available.</p>';
      return;
    }

    // Create a pane with two columns: list of runbooks and content area
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex; gap:16px; height: calc(100vh - 150px);';
    
    // Sidebar list
    const sidebar = document.createElement('div');
    sidebar.style.cssText = 'flex: 0 0 250px; overflow-y:auto; background:var(--bg-2); border-radius:8px; padding:8px;';
    
    const list = document.createElement('ul');
    list.style.cssText = 'list-style:none; margin:0; padding:0;';
    templates.forEach(t => {
      const li = document.createElement('li');
      li.textContent = t.display_name || t.name.replace(/-/g, ' ');
      li.style.cssText = 'padding:8px; cursor:pointer; border-radius:4px;';
      li.onclick = () => {
        // Highlight selected
        list.querySelectorAll('li').forEach(elm => elm.style.background = '');
        li.style.background = 'var(--accent)';
        li.style.color = 'var(--bg)';
        // Load runbook content
        fetchRunbookContent(t.runbookRef || t.name, contentPane);
      };
      list.appendChild(li);
    });
    sidebar.appendChild(list);
    wrapper.appendChild(sidebar);

    // Content area
    const contentPane = document.createElement('div');
    contentPane.style.cssText = 'flex:1; overflow-y:auto; background:var(--surface); border-radius:8px; padding:16px; border:1px solid var(--border);';
    contentPane.innerHTML = '<p style="color:var(--muted);">Select a runbook from the list.</p>';
    wrapper.appendChild(contentPane);

    contentDiv.innerHTML = '';
    contentDiv.appendChild(wrapper);

  } catch (err) {
    console.error('[Runbooks]', err);
    contentDiv.innerHTML = '<p style="color:var(--accent-3);">Error loading runbooks.</p>';
  }
}

/**
/**
 * Fetch runbook content and render as markdown (simplified)
 */
async function fetchRunbookContent(name, container) {
  try {
    const resp = await fetch(`/api/runbook/${name}`);
    if (!resp.ok) {
      container.innerHTML = '<p style="color:var(--accent-3);">Runbook not found.</p>';
      return;
    }
    const text = await resp.text();
    // Simple markdown conversion
    let html = text
      .replace(/^# (.*)$/gim, '<h1>$1</h1>')
      .replace(/^## (.*)$/gim, '<h2>$1</h2>')
      .replace(/^### (.*)$/gim, '<h3>$1</h3>')
      .replace(/^> (.*)$/gim, '<blockquote>$1</blockquote>')
      .replace(/^\s*-\s+(.*)$/gim, '<li>$1</li>')
      .replace(/\n/gim, '<br>');
    container.innerHTML = `<div class="runbook-content" style="line-height:1.6;">${html}</div>`;
  } catch (e) {
    container.innerHTML = '<p style="color:var(--accent-3);">Failed to load runbook.</p>';
  }
}


function updateViewButtons(state) {
  document.querySelectorAll('.view-btn').forEach(btn => {
    const isActive = btn.dataset.view === (state?.view || 'list');
    btn.setAttribute('aria-pressed', isActive);
  });
}

/**
 * Show a notice message
 */
function showNotice(message, type = 'info') {
  if (!message) return;
  dom.notice.textContent = message;
  dom.notice.className = `notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    dom.notice.className = 'notice';
    dom.notice.textContent = '';
  }, 4200);
}

// ==================== Task Operations ====================

async function handleToggleTask(id) {
  const startTime = performance.now();
  try {
    await toggleTask(id);
    const duration = performance.now() - startTime;
    performanceMonitor.record('toggle-task', duration);
  } catch (error) {
    showNotice('Failed to update task.', 'error');
  }
}

async function startEdit(id) {
  const state = await getState();
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  await fetchTaskOptions();
  editingId = id;
  editingText = task.text;
  editingCategory = task.category || 'General';
  editingStatus = task.status || 'backlog';
  editingPriority = task.priority || 'medium';
  editingOwner = task.owner || '';
  editingDueDate = task.due_date ? task.due_date.split('T')[0] : '';
  editingStartDate = task.start_date ? task.start_date.split('T')[0] : '';
  editingDescription = task.description || '';
  editingEstimatedEffort = task.estimated_effort || '';
  editingActualEffort = task.actual_effort || '';
  editingRecurrence = task.recurrence_rule || null;
  editingModel = getTaskPreferredModel(task) || '';
  renderTasks();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-edit-input="${id}"]`);
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

async function saveEdit(id) {
  const state = await getState();
  const currentTask = state.tasks.find(task => task.id === id);
  const text = editingText.trim();
  if (!text) {
    showNotice('Task text cannot be empty.', 'error');
    return;
  }

  skeletonLoader.setButtonLoading(document.querySelector('[data-action="save"]'), 'Save');

  const startTime = performance.now();
  try {
    await updateTask(id, {
      text,
      category: editingCategory,
      status: editingStatus,
      priority: editingPriority,
      owner: editingOwner || null,
      due_date: editingDueDate || null,
      start_date: editingStartDate || null,
      description: editingDescription,
      estimated_effort: editingEstimatedEffort ? Number(editingEstimatedEffort) : null,
      actual_effort: editingActualEffort ? Number(editingActualEffort) : null,
      recurrence_rule: editingRecurrence,
      metadata: buildTaskMetadata(currentTask?.metadata || {}, { preferredModel: editingModel })
    });
    editingId = null;
    editingText = '';
    editingCategory = '';
    editingStatus = '';
    editingPriority = '';
    editingOwner = '';
    editingDueDate = '';
    editingStartDate = '';
    editingDescription = '';
    editingEstimatedEffort = null;
    editingActualEffort = null;
    editingRecurrence = null;
    editingModel = '';
    showNotice('Task updated.', 'success');
    const duration = performance.now() - startTime;
    performanceMonitor.record('update-task', duration);
  } catch (error) {
    showNotice('Failed to update task.', 'error');
  } finally {
    skeletonLoader.clearButtonLoading(document.querySelector('[data-action="save"]'));
  }
}

function cancelEdit() {
  editingId = null;
  editingText = '';
  editingCategory = '';
  editingStatus = '';
  editingPriority = '';
  editingOwner = '';
  editingDueDate = '';
  editingStartDate = '';
  editingDescription = '';
  editingEstimatedEffort = null;
  editingActualEffort = null;
  editingRecurrence = null;
  editingModel = '';
  renderTasks();
}

/**
 * Toggle expansion of a task's subtasks
 * @param {string|number} taskId - Task ID to toggle
 */
function toggleExpansion(taskId) {
  if (expandedTaskIds.has(taskId)) {
    expandedTaskIds.delete(taskId);
  } else {
    expandedTaskIds.add(taskId);
  }
  // Re-render to update view
  renderTasks();
}

// ==================== UX ENHANCEMENTS ====================

// Undo snackbar
let undoAction = null;
let snackbarTimer = null;

/**
 * Show an undo snackbar with a callback to execute if undo is clicked.
 */
function showUndoSnackbar(message, onUndo) {
  const snackbar = document.getElementById('snackbar');
  const msgEl = document.getElementById('snackbarMessage');
  const undoBtn = document.getElementById('snackbarUndo');
  if (!snackbar || !msgEl || !undoBtn) {
    console.warn('Snackbar elements not found');
    if (onUndo) onUndo();
    return;
  }

  undoAction = onUndo;
  msgEl.textContent = message;
  snackbar.classList.add('visible');

  clearTimeout(snackbarTimer);
  snackbarTimer = setTimeout(() => {
    snackbar.classList.remove('visible');
    undoAction = null;
  }, 6000);

  // Replace undo button to avoid duplicate handlers
  const newUndoBtn = undoBtn.cloneNode(true);
  undoBtn.parentNode.replaceChild(newUndoBtn, undoBtn);
  newUndoBtn.onclick = () => {
    if (undoAction) {
      undoAction();
      undoAction = null;
    }
    snackbar.classList.remove('visible');
    clearTimeout(snackbarTimer);
  };
}

// Agent fetching and owner assignment
let cachedAgents = null;

/**
 * Fetch available agents from the server and cache the result.
 * Returns an array of agent names (or IDs if name missing).
 */
async function fetchAgents() {
  if (getAgentCatalog().length > 0) {
    return getAgentCatalog().map(agent => agent.id);
  }
  if (cachedAgents !== null) {
    return cachedAgents;
  }
  try {
    const res = await fetch('/api/agents');
    if (res.ok) {
      const data = await res.json();
      const agents = data.agents || [];
      cachedAgents = agents.map(a => a.agent_name || a.agent_id || a.name || a.id || a).filter(Boolean);
    } else {
      cachedAgents = [];
    }
  } catch (e) {
    console.warn('[Dashboard] Could not fetch agents:', e);
    cachedAgents = [];
  }
  return cachedAgents;
}

/**
 * Create an owner chip element for a task.
 */
function createOwnerChip(task) {
  const chip = document.createElement('span');
  chip.className = 'owner-chip';
  chip.title = task.owner ? 'Change assignment' : 'Assign to agent';
  chip.dataset.taskId = task.id;

  const name = document.createElement('span');
  name.textContent = getAgentDisplayName(task.owner);
  chip.appendChild(name);

  if (task.owner) {
    const remove = document.createElement('span');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = 'Clear assignment';
    remove.onclick = (e) => {
      e.stopPropagation();
      updateTask(task.id, { owner: null });
    };
    chip.appendChild(remove);
  }

  chip.onclick = (e) => {
    if (e.target.classList.contains('remove')) return;
    showOwnerDropdown(chip, task);
  };

  return chip;
}

/**
 * Show a dropdown menu to select an agent for assignment.
 */
async function showOwnerDropdown(anchorChip, task) {
  // Remove any existing dropdowns
  document.querySelectorAll('.owner-dropdown').forEach(el => el.remove());

  // Fetch agents if not cached
  const agents = await fetchAgents();

  const dropdown = document.createElement('div');
  dropdown.className = 'owner-dropdown';
  dropdown.style.position = 'fixed';
  const rect = anchorChip.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = (rect.bottom + 4) + 'px';
  dropdown.style.zIndex = '1000';

  if (agents.length === 0) {
    const empty = document.createElement('button');
    empty.textContent = 'No agents';
    empty.disabled = true;
    dropdown.appendChild(empty);
  } else {
    agents.forEach(agent => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = getAgentDisplayName(agent);
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 10px;background:none;border:none;color:var(--text);cursor:pointer;border-radius:4px;';
      btn.onclick = () => {
        updateTask(task.id, { owner: agent });
        dropdown.remove();
      };
      dropdown.appendChild(btn);
    });
  }

  // Close on click outside
  const close = (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.remove();
      document.removeEventListener('click', close);
    }
  };
  document.addEventListener('click', close);
  document.body.appendChild(dropdown);
}

// ==================== TASK OPERATIONS ====================

async function deleteTaskById(id) {
  const state = await getState();
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (confirm(`Delete "${task.text}"?`)) {
    try {
      // Snapshot for undo
      const snapshot = await getState();
      await deleteTask(id);
      showNotice('Task deleted.', 'success');
      // Show undo snackbar
      showUndoSnackbar('Task deleted.', async () => {
        // Restore state to snapshot
        await setState(snapshot);
        renderTasks();
      });
    } catch (error) {
      showNotice('Failed to delete task.', 'error');
    }
  }
}

async function archiveTaskById(id) {
  try {
    await archiveTask(id);
    showNotice('Task archived.', 'success');
    // Refresh tasks to reflect archive status (task disappears from non-archive views)
    renderTasksDebounced();
  } catch (error) {
    showNotice('Failed to archive task.', 'error');
  }
}

async function restoreTaskById(id) {
  try {
    await restoreTask(id);
    showNotice('Task restored.', 'success');
    renderTasksDebounced();
  } catch (error) {
    showNotice('Failed to restore task.', 'error');
  }
}

async function handleClearCompleted() {
  try {
    const snapshot = await getState();
    await clearCompleted();
    showNotice('Completed tasks cleared.', 'success');
    showUndoSnackbar('Completed tasks archived.', async () => {
      await setState(snapshot);
      renderTasks();
    });
  } catch (error) {
    showNotice('Failed to clear completed tasks.', 'error');
  }
}

/**
 * Create an edit form element for a task.
 */
function createEditElement(task) {
  const container = document.createElement('div');
  container.className = `task-item task-edit priority-${editingPriority || task.priority || 'medium'}`;
  container.dataset.taskId = task.id;

  const formatTokenLabel = (value) => String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

  const createField = (labelText, control, options = {}) => {
    const field = document.createElement('label');
    field.className = 'task-edit-field';
    if (options.full) {
      field.classList.add('task-edit-field--full');
    }

    const label = document.createElement('span');
    label.className = 'task-edit-label';
    label.textContent = labelText;

    field.append(label, control);
    return field;
  };

  const createChip = (text) => {
    const chip = document.createElement('span');
    chip.className = 'task-edit-chip';
    chip.textContent = text;
    return chip;
  };

  const createPanelHeading = (title, copy) => {
    const heading = document.createElement('div');
    heading.className = 'task-edit-panel-heading';

    const titleEl = document.createElement('h4');
    titleEl.textContent = title;
    heading.appendChild(titleEl);

    if (copy) {
      const copyEl = document.createElement('p');
      copyEl.className = 'task-edit-panel-copy';
      copyEl.textContent = copy;
      heading.appendChild(copyEl);
    }

    return heading;
  };

  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  });

  const createdAt = task.createdAt || task.created_at;
  const updatedAt = task.updatedAt || task.updated_at;

  const header = document.createElement('div');
  header.className = 'task-edit-header';

  const heading = document.createElement('div');
  heading.className = 'task-edit-heading';

  const kicker = document.createElement('span');
  kicker.className = 'task-edit-kicker';
  kicker.textContent = 'Task editor';

  const title = document.createElement('h3');
  title.className = 'task-edit-title';
  title.textContent = editingText || task.text || 'Untitled task';

  const summary = document.createElement('div');
  summary.className = 'task-edit-summary';

  const timelineBits = [];
  if (createdAt) timelineBits.push(`Created ${formatDate(createdAt)}`);
  if (updatedAt) timelineBits.push(`Updated ${formatDate(updatedAt)}`);
  if (timelineBits.length) {
    const timeline = document.createElement('span');
    timeline.textContent = timelineBits.join(' • ');
    summary.appendChild(timeline);
  }

  const statusChip = createChip('');
  summary.appendChild(statusChip);

  if (task.parent_task_id) summary.appendChild(createChip('Subtask'));
  if (task.__childStats?.total) summary.appendChild(createChip(`${task.__childStats.total} subtasks`));

  const recurrenceChip = createChip('');
  summary.appendChild(recurrenceChip);

  const modelChip = createChip('');
  summary.appendChild(modelChip);

  const overdueChip = createChip('Overdue');
  summary.appendChild(overdueChip);

  heading.append(kicker, title, summary);
  header.appendChild(heading);

  const updatePriorityClass = () => {
    container.classList.remove('priority-low', 'priority-medium', 'priority-high', 'priority-critical');
    container.classList.add(`priority-${editingPriority || task.priority || 'medium'}`);
  };

  const refreshSummary = () => {
    statusChip.textContent = `Status: ${formatTokenLabel(editingStatus || getTaskStatus(task))}`;

    if (editingRecurrence) {
      recurrenceChip.hidden = false;
      recurrenceChip.textContent = `Repeats ${formatTokenLabel(editingRecurrence)}`;
    } else {
      recurrenceChip.hidden = true;
    }

    if (editingModel) {
      modelChip.hidden = false;
      modelChip.textContent = `Model: ${getModelChipLabel(editingModel)}`;
      modelChip.title = editingModel;
    } else {
      modelChip.hidden = true;
      modelChip.title = '';
    }

    const overdue = Boolean(
      editingDueDate &&
      editingStatus !== 'completed' &&
      editingStatus !== 'archived' &&
      new Date(`${editingDueDate}T23:59:59`).getTime() < Date.now()
    );
    overdueChip.hidden = !overdue;
  };

  // Text input
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.value = editingText;
  textInput.dataset.editInput = task.id;
  textInput.placeholder = 'Task text';
  textInput.setAttribute('aria-label', 'Task name');
  textInput.addEventListener('input', (e) => {
    editingText = e.target.value;
    title.textContent = editingText.trim() || task.text || 'Untitled task';
  });
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit(task.id);
    }
  });

  // Category input
  const categoryInput = document.createElement('input');
  categoryInput.type = 'text';
  categoryInput.value = editingCategory;
  categoryInput.placeholder = 'Category';
  categoryInput.setAttribute('aria-label', 'Category');
  categoryInput.addEventListener('input', (e) => { editingCategory = e.target.value; });

  const titleRow = document.createElement('div');
  titleRow.className = 'task-edit-title-row';

  const descriptionInput = document.createElement('textarea');
  descriptionInput.rows = 8;
  descriptionInput.value = editingDescription;
  descriptionInput.placeholder = 'Description';
  descriptionInput.setAttribute('aria-label', 'Description');
  descriptionInput.addEventListener('input', (e) => { editingDescription = e.target.value; });
  descriptionInput.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveEdit(task.id);
    }
  });

  // Status select
  const statusSelect = document.createElement('select');
  ['backlog','ready','in_progress','blocked','review','completed','archived'].forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = formatTokenLabel(s);
    if (s === editingStatus) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.setAttribute('aria-label', 'Status');
  statusSelect.addEventListener('change', () => {
    editingStatus = statusSelect.value;
    refreshSummary();
  });

  // Priority select
  const prioritySelect = document.createElement('select');
  ['low','medium','high','critical'].forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = formatTokenLabel(p);
    if (p === editingPriority) opt.selected = true;
    prioritySelect.appendChild(opt);
  });
  prioritySelect.setAttribute('aria-label', 'Priority');
  prioritySelect.addEventListener('change', () => {
    editingPriority = prioritySelect.value;
    updatePriorityClass();
  });

  // Owner input (text for now)
  const ownerInput = document.createElement('input');
  ownerInput.type = 'text';
  ownerInput.value = editingOwner;
  ownerInput.placeholder = 'Owner';
  ownerInput.setAttribute('aria-label', 'Owner');
  ownerInput.addEventListener('input', (e) => { editingOwner = e.target.value; });

  // Start date
  const startDateInput = document.createElement('input');
  startDateInput.type = 'date';
  startDateInput.value = editingStartDate;
  startDateInput.setAttribute('aria-label', 'Start date');
  startDateInput.addEventListener('input', (e) => { editingStartDate = e.target.value; });

  // Due date
  const dueDateInput = document.createElement('input');
  dueDateInput.type = 'date';
  dueDateInput.value = editingDueDate;
  dueDateInput.setAttribute('aria-label', 'Due date');
  dueDateInput.addEventListener('input', (e) => {
    editingDueDate = e.target.value;
    refreshSummary();
  });

  const estimatedEffortInput = document.createElement('input');
  estimatedEffortInput.type = 'number';
  estimatedEffortInput.step = '0.5';
  estimatedEffortInput.min = '0';
  estimatedEffortInput.placeholder = 'Est hrs';
  estimatedEffortInput.value = editingEstimatedEffort;
  estimatedEffortInput.setAttribute('aria-label', 'Estimated hours');
  estimatedEffortInput.addEventListener('input', (e) => { editingEstimatedEffort = e.target.value; });

  const actualEffortInput = document.createElement('input');
  actualEffortInput.type = 'number';
  actualEffortInput.step = '0.5';
  actualEffortInput.min = '0';
  actualEffortInput.placeholder = 'Actual hrs';
  actualEffortInput.value = editingActualEffort;
  actualEffortInput.setAttribute('aria-label', 'Actual hours');
  actualEffortInput.addEventListener('input', (e) => { editingActualEffort = e.target.value; });

  const recurrenceSelect = document.createElement('select');
  ['none', 'daily', 'weekly', 'monthly', 'yearly'].forEach(rule => {
    const opt = document.createElement('option');
    opt.value = rule;
    opt.textContent = formatTokenLabel(rule);
    recurrenceSelect.appendChild(opt);
  });
  recurrenceSelect.value = editingRecurrence || 'none';
  recurrenceSelect.setAttribute('aria-label', 'Recurrence');
  recurrenceSelect.addEventListener('change', () => {
    editingRecurrence = recurrenceSelect.value === 'none' ? null : recurrenceSelect.value;
    refreshSummary();
  });

  const modelSelect = document.createElement('select');
  const blankModelOption = document.createElement('option');
  blankModelOption.value = '';
  blankModelOption.textContent = 'No model preference';
  modelSelect.appendChild(blankModelOption);
  getModelCatalog().forEach((model) => {
    const opt = document.createElement('option');
    opt.value = model.id;
    opt.textContent = getModelDisplayName(model.id);
    modelSelect.appendChild(opt);
  });
  if (editingModel && !Array.from(modelSelect.options).some(option => option.value === editingModel)) {
    const customModelOption = document.createElement('option');
    customModelOption.value = editingModel;
    customModelOption.textContent = editingModel;
    modelSelect.appendChild(customModelOption);
  }
  modelSelect.value = editingModel || '';
  modelSelect.setAttribute('aria-label', 'Preferred model');
  modelSelect.addEventListener('change', () => {
    editingModel = modelSelect.value;
    refreshSummary();
  });

  const descriptionPanel = document.createElement('section');
  descriptionPanel.className = 'task-edit-panel';
  descriptionPanel.append(
    createPanelHeading('Task brief', 'Capture the goal, edge cases, and any notes the next person needs.'),
    createField('Description', descriptionInput, { full: true })
  );

  const detailPanel = document.createElement('section');
  detailPanel.className = 'task-edit-panel';

  const detailFields = document.createElement('div');
  detailFields.className = 'task-edit-fields';
  detailFields.append(
    createField('Status', statusSelect),
    createField('Priority', prioritySelect),
    createField('Owner', ownerInput, { full: true }),
    createField('Start date', startDateInput),
    createField('Due date', dueDateInput),
    createField('Estimated hours', estimatedEffortInput),
    createField('Actual hours', actualEffortInput),
    createField('Preferred model', modelSelect, { full: true }),
    createField('Recurrence', recurrenceSelect, { full: true })
  );

  detailPanel.append(
    createPanelHeading('Execution settings', 'Set workflow state, ownership, timing, and repeat cadence.'),
    detailFields
  );

  const body = document.createElement('div');
  body.className = 'task-edit-body';
  body.append(descriptionPanel, detailPanel);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'task-actions task-edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'action-btn save-btn';
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.dataset.action = 'save'; // for skeletonLoader
  saveBtn.addEventListener('click', () => saveEdit(task.id));

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'action-btn cancel-btn';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', cancelEdit);

  actions.append(saveBtn, cancelBtn);

  const footer = document.createElement('div');
  footer.className = 'task-edit-footer';

  const hint = document.createElement('div');
  hint.className = 'task-edit-hint';
  hint.textContent = 'Press Ctrl+Enter inside the description to save quickly, or Esc anywhere in the editor to cancel.';

  footer.append(hint, actions);

  // Assemble
  titleRow.append(
    createField('Task name', textInput),
    createField('Category', categoryInput)
  );

  updatePriorityClass();
  refreshSummary();
  container.append(header, titleRow, body, footer);
  return container;
}

// ==================== Export/Import ====================

function exportJson() {
  skeletonLoader.setButtonLoading(dom.exportJsonBtn, 'Export JSON');
  getState().then(state => {
    const data = JSON.stringify(state.tasks, null, 2);
    downloadFile(data, 'tasks.json', 'application/json');
    skeletonLoader.clearButtonLoading(dom.exportJsonBtn);
  }).catch(() => {
    skeletonLoader.clearButtonLoading(dom.exportJsonBtn);
    showNotice('Failed to export tasks.', 'error');
  });
}

function exportCsv() {
  skeletonLoader.setButtonLoading(dom.exportCsvBtn, 'Export CSV');
  getState().then(state => {
    const headers = ['ID', 'Text', 'Category', 'Completed', 'Created At', 'Updated At'];
    const rows = state.tasks.map(t => [
      t.id,
      `"${t.text.replace(/"/g, '""')}"`,
      t.category,
      t.completed,
      t.createdAt,
      t.updatedAt || ''
    ]);
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    downloadFile(csv, 'tasks.csv', 'text/csv');
    skeletonLoader.clearButtonLoading(dom.exportCsvBtn);
  }).catch(() => {
    skeletonLoader.clearButtonLoading(dom.exportCsvBtn);
    showNotice('Failed to export tasks.', 'error');
  });
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Show loading state
  skeletonLoader.setButtonLoading(dom.importBtn, 'Importing...');

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const content = e.target.result;
      let tasks;
      if (file.name.endsWith('.json')) {
        tasks = JSON.parse(content);
      } else if (file.name.endsWith('.csv')) {
        tasks = parseCsv(content);
      } else {
        throw new Error('Unsupported file format');
      }

      if (!Array.isArray(tasks)) throw new Error('Invalid format');

      let importCount = 0;
      for (const task of tasks) {
        if (task.text || task.title) {
          await addTask(task);
          importCount++;
        }
      }
      showNotice(`Imported ${importCount} tasks.`, 'success');
    } catch (error) {
      showNotice('Failed to import tasks. Please check the file format.', 'error');
    } finally {
      skeletonLoader.clearButtonLoading(dom.importBtn);
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function parseCsv(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const tasks = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    const task = {};
    headers.forEach((header, index) => {
      const key = header.toLowerCase();
      if (key === 'text') task.text = values[index];
      if (key === 'category') task.category = values[index];
      if (key === 'completed') task.completed = values[index] === 'true';
    });
    if (task.text) tasks.push(task);
  }
  return tasks;
}

/**
 * Format date for display
 */
function formatTimestamp(isoString) {
  if (!isoString) {
    return 'Unknown';
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return String(isoString);
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Get current state synchronously (quick check without async)
 * Used for making fast decisions before async state load
 */
function getStateSync() {
  return latestStateSnapshot || { tasks: [], categories: [], savedViews: [] };
}

// Export for debugging
window.dashboardDebug = {
  getState,
  addTask,
  toggleTask,
  deleteTask,
  performanceMonitor,
  virtualScroller: () => virtualScroller,
  isVirtualScrolling: () => isVirtualScrolling,
  taskPool,
  workerAvailable: () => workerAvailable
};

console.log('[Dashboard] Optimized module loaded');

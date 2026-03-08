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
  addTask, 
  toggleTask, 
  updateTask, 
  deleteTask, 
  clearCompleted,
  subscribe,
  normalizeTask // Add import
} from './offline/state-manager.mjs';

import { offlineUI } from './offline/offline-ui.mjs';

// Performance monitoring
import { performanceMonitor } from './performance-monitor.mjs';

// Skeleton loader
import { skeletonLoader } from './skeleton-loader.mjs';

/**
 * Fetch available agents from the API and store globally.
 */
async function fetchAgents() {
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) throw new Error('Failed to fetch agents');
    const data = await res.json();
    window.availableAgents = data.agents || [];
  } catch (e) {
    console.error('[Dashboard] Agent fetch failed:', e);
    window.availableAgents = ['openclaw'];
  }
}

// Virtual scroller (only used when needed)
let VirtualScroller = null;

// Timeline view (lazy loading)
let TimelineView = null;

// Web Worker for expensive operations
let dashboardWorker = null;
let workerAvailable = false;

// Promise-based worker coordination
let pendingFilterSortResolve = null;
let pendingSearchResolve = null;

// DOM references
const dom = {
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.getElementById('themeIcon'),
  themeLabel: document.getElementById('themeLabel'),
  taskInput: document.getElementById('taskInput'),
  categoryInput: document.getElementById('categoryInput'),
  addTaskBtn: document.getElementById('addTaskBtn'),
  notice: document.getElementById('notice'),
  totalTasks: document.getElementById('totalTasks'),
  completedTasks: document.getElementById('completedTasks'),
  pendingTasks: document.getElementById('pendingTasks'),
  filterAllCount: document.getElementById('filterAllCount'),
  filterPendingCount: document.getElementById('filterPendingCount'),
  filterCompletedCount: document.getElementById('filterCompletedCount'),
  filterMyTasksCount: document.getElementById('filterMyTasksCount'),
  filterOverdueCount: document.getElementById('filterOverdueCount'),
  filterBlockedCount: document.getElementById('filterBlockedCount'),
  filterNoDueDateCount: document.getElementById('filterNoDueDateCount'),
  filterButtons: document.querySelectorAll('.filter-btn'),
  searchInput: document.getElementById('searchInput'),
  categoryFilter: document.getElementById('categoryFilter'),
  sortSelect: document.getElementById('sortSelect'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  clearCompletedBtn: document.getElementById('clearCompletedBtn'),
  taskList: document.getElementById('taskList'),
  emptyState: document.getElementById('emptyState'),
  emptyMessage: document.getElementById('emptyMessage'),
  categoryOptions: document.getElementById('categoryOptions'),
  projectSelect: document.getElementById('projectSelect'),
  agentSelect: null,
  agentStatsContainer: null
};

// State
let editingId = null;
let editingText = '';
let editingCategory = '';
let editingStatus = '';
let editingPriority = 'medium';
let editingOwner = '';
let editingStartDate = '';
let editingDueDate = '';
let undoStack = [];
let noticeTimer = null;
let currentView = 'list';
let virtualScroller = null;
let isVirtualScrolling = false;
let taskPool = []; // DOM element pool for recycling
let searchDebounceTimer = null;
let isInitialized = false;
let agentRefreshInterval = null;
let currentAgent = null;
let agentTasks = [];
let agentStats = null;
let agentPaused = false; // Pause state for agent heartbeat
let expandedTaskIds = new Set(); // Set of task IDs with expanded children

// Memoization cache for filtered tasks
const filterCache = new Map();
let lastFilterHash = '';
let lastTaskCount = -1;

// Performance tracking
let renderStartTime = 0;

/**
 * Load tasks from Asana API.
 * @param {Object} state - Current state object.
 * @returns {Promise<Object[]>} Array of tasks from the API.
 */
async function loadTasksFromAsanaAPI(state) {
  try {
    // Determine project ID: use from state if set, otherwise fetch projects
    let projectId = state.project_id;
    if (!projectId) {
      const projectsRes = await fetch('/api/projects');
      if (!projectsRes.ok) throw new Error('Failed to fetch projects');
      const projects = await projectsRes.json();
      if (projects.length === 0) throw new Error('No projects found');
      // Pick first non-archived project, or just first
      projectId = projects[0].id;
      // Persist project choice
      state.project_id = projectId;
      await setState(state);
    }
    
    // Fetch tasks for this project
    const tasksRes = await fetch(`/api/tasks/all?project_id=${encodeURIComponent(projectId)}`);
    if (!tasksRes.ok) throw new Error('Failed to fetch tasks');
    const tasksData = await tasksRes.json();
    
    // tasksData is an array of task objects from Asana
    // They will be normalized via state manager's normalizeTask when we setState
    return tasksData;
  } catch (error) {
    console.error('[Dashboard] loadTasksFromAsanaAPI failed:', error);
    throw error;
  }
}

/**
 * Find a project that has at least one task.
 * Iterates through all projects and returns the first with tasks.
 * @returns {Promise<{projectId: string, tasks: Object[]}>} Project ID and tasks.
 */
async function findProjectWithTasks() {
  const projectsRes = await fetch('/api/projects');
  if (!projectsRes.ok) throw new Error('Failed to fetch projects for auto-select');
  const projects = await projectsRes.json();
  if (projects.length === 0) throw new Error('No projects available');

  for (const proj of projects) {
    const tasksRes = await fetch(`/api/tasks/all?project_id=${encodeURIComponent(proj.id)}`);
    if (!tasksRes.ok) continue;
    const tasks = await tasksRes.json();
    if (Array.isArray(tasks) && tasks.length > 0) {
      return { projectId: proj.id, tasks };
    }
  }
  throw new Error('No project with tasks found');
}

/**
 * Initialize dashboard module and UI bindings.
 * @returns {void}
 */
(function initDashboard() {
  console.log('[Dashboard] Initializing with performance optimizations...');

  // Load performance monitor
  if (window.performanceMonitor) {
    performanceMonitor.setEnabled(true);
  }

  // Initialize Web Worker early
  initWorker().catch(console.warn);

  // Initialize state manager
  initState().then(async (state) => {
    // Initialize offline UI
    offlineUI.init();
    // Pre-fetch agents for owner assignment
    fetchAgents().catch(console.error);
    
    // Load tasks from Asana API if available (to get fresh data with status)
    try {
      let asanaTasks = await loadTasksFromAsanaAPI(state);
      
      // If we got no tasks, attempt to auto-select a project that has tasks
      if (!asanaTasks || asanaTasks.length === 0) {
        console.log('[Dashboard] Selected project has no tasks, searching for a project with tasks...');
        try {
          const result = await findProjectWithTasks();
          asanaTasks = result.tasks;
          state.project_id = result.projectId;
          await setState(state);
          console.log(`[Dashboard] Switched to project ${result.projectId} with ${asanaTasks.length} tasks`);
        } catch (e) {
          console.warn('[Dashboard] Could not find a project with tasks:', e.message);
          asanaTasks = []; // remain empty
        }
      }

      if (asanaTasks && asanaTasks.length > 0) {
        // Normalize tasks using state manager's function
        const normalizedTasks = asanaTasks.map(t => normalizeTask(t)).filter(Boolean);
        state.tasks = normalizedTasks;
        await setState(state);
        console.log(`[Dashboard] Loaded and normalized ${normalizedTasks.length} tasks from Asana API`);
      } else {
        console.log('[Dashboard] No tasks from Asana API, using local storage');
      }
    } catch (error) {
      console.warn('[Dashboard] Asana API not available, using local storage:', error.message);
    }

    // Populate project selector
    populateProjectSelector(state);

    // Set up event listeners with debouncing where appropriate
    setupEventListeners();

    // Initial render with skeleton (using updated state)
    const currentState = await getState();
    renderStartTime = performance.now();
    await renderTasksWithSkeleton(currentState);
    const duration = performance.now() - renderStartTime;
    performanceMonitor.record('view-switch-initial', duration, { view: 'list' });
    console.log(`[Dashboard] Initial render completed in ${duration.toFixed(2)}ms`);

    // Update other UI
    await renderCategoryOptions();
    updateStats(currentState);
    updateFilterButtons(currentState);
    updateSearchSortUI(currentState);
    updateThemeUI(currentState);
    updateViewButtons(currentState);

    isInitialized = true;
    console.log('[Dashboard] Ready with optimizations');
  }).catch(error => {
    console.error('[Dashboard] Initialization failed:', error);
    showNotice('Failed to initialize dashboard. Please refresh.', 'error');
  });
})();

/**
 * Initialize Web Worker for filtering/sorting.
 * @returns {Promise<void>}
 */
async function initWorker() {
  try {
    dashboardWorker = new Worker('./src/dashboard-worker.js', { type: 'module' });
    
    dashboardWorker.onmessage = (e) => {
      const { type, result, duration } = e.data;
      
      if (type === 'FILTER_SORT_COMPLETE') {
        performanceMonitor.record('filter-sort-worker', duration);
        if (pendingFilterSortResolve) {
          pendingFilterSortResolve(result);
          pendingFilterSortResolve = null;
        } else {
          // Fallback: auto-render (for backwards compatibility)
          renderWorkerResults(result);
        }
      } else if (type === 'SEARCH_COMPLETE') {
        performanceMonitor.record('search-worker', duration);
        if (pendingSearchResolve) {
          pendingSearchResolve(result);
          pendingSearchResolve = null;
        } else {
          renderWorkerResults(result);
        }
      } else if (type === 'INIT_COMPLETE') {
        workerAvailable = true;
        console.log('[Dashboard] Web Worker initialized');
      }
    };

    dashboardWorker.onerror = (error) => {
      console.error('[Dashboard] Worker error:', error);
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
 * Set up all UI event listeners with debouncing where appropriate.
 * @returns {void}
 */
function setupEventListeners() {
  dom.taskList?.setAttribute('tabindex', '-1');
  dom.taskList?.setAttribute('aria-label', 'Task list');

  // Theme toggle
  dom.themeToggle?.addEventListener('click', () => {
    getState().then(state => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      updateState({ theme: newTheme }).then(() => {
        updateThemeUI({ theme: newTheme });
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
    
    // Show loading state
    skeletonLoader.setButtonLoading(dom.addTaskBtn, 'Add Task');
    
    try {
      await addTask(text, dom.categoryInput.value);
      dom.taskInput.value = '';
      dom.categoryInput.value = '';
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

  // Filter buttons (debounced to prevent rapid re-renders)
  dom.filterButtons?.forEach(button => {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      updateState({ filter }).then(() => {
        renderTasksDebounced();
        getState().then(updateFilterButtons);
      });
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

  // Sort (immediate)
  dom.sortSelect?.addEventListener('change', (e) => {
    updateState({ sort: e.target.value }).then(() => {
      renderTasksDebounced();
    });
  });

  // Project selector
  dom.projectSelect?.addEventListener('change', handleProjectChange);

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
      await clearCompleted();
      showNotice('Completed tasks cleared.', 'success');
    } catch (error) {
      showNotice('Failed to clear completed tasks.', 'error');
    }
  });

  // Subscribe to state changes
  subscribe(async (event, state) => {
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

  // Performance monitoring (dev mode only)
  if (window.location.hash === '#perf') {
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        console.log(performanceMonitor.getSummary());
      }
    });
  }

  // Delegated task actions
  dom.taskList?.addEventListener('click', handleTaskListClick);
  dom.taskList?.addEventListener('keydown', handleTaskListKeydown);
}

/**
 * Synchronize all UI elements with current state.
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
 */
async function syncUI(state) {
  await renderCategoryOptions();
  await renderTasks(); // Handles skeleton loading internally
  await updateStats(state);
  updateFilterButtons(state);
  updateSearchSortUI(state);
  updateThemeUI(state);
  updateViewButtons(state);
}

/**
 * Render category options dropdown.
 * @returns {Promise<void>}
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

/**
 * Populate project selector with available projects.
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
 */
async function populateProjectSelector(state) {
  if (!dom.projectSelect) return;
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error('Failed to fetch projects');
    const projects = await res.json();
    dom.projectSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Select Project --';
    dom.projectSelect.appendChild(placeholder);
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      dom.projectSelect.appendChild(opt);
    });
    if (state.project_id) {
      dom.projectSelect.value = state.project_id;
    }
  } catch (e) {
    console.error('[Dashboard] populateProjectSelector error:', e);
  }
}

/**
 * Handle project selection change.
 * @param {Event} event - Change event.
 * @returns {Promise<void>}
 */
async function handleProjectChange(event) {
  const projectId = event.target.value;
  if (!projectId) return;
  try {
    const state = await getState();
    state.project_id = projectId;
    await setState(state);
    showNotice('Loading project tasks...', 'info');
    const asanaTasks = await loadTasksFromAsanaAPI(state);
    const normalized = asanaTasks.map(t => normalizeTask(t)).filter(Boolean);
    state.tasks = normalized;
    await setState(state); // triggers UI sync
    showNotice('Project tasks loaded.', 'success');
  } catch (error) {
    console.error('[Dashboard] Project change failed:', error);
    showNotice('Failed to load project tasks.', 'error');
  }
}

/**
 * Render tasks with skeleton loading.
 * Uses Web Worker for filtering/sorting when dataset >200 tasks.
 * Uses virtual scrolling for >100 visible tasks.
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
 */
async function renderTasksWithSkeleton(state) {
  try {
    const totalTaskCount = state?.tasks?.length || 0;
    
    // Show empty state if no tasks
    if (totalTaskCount === 0) {
      dom.taskList.innerHTML = '';
      dom.emptyState.style.display = 'block';
      dom.emptyMessage.textContent = 'No tasks yet. Add one above!';
      return;
    }
    
    // Determine if we should use worker (large dataset >200 total tasks)
    const useWorker = workerAvailable && totalTaskCount > 200;
    
    // Show skeleton during computation for large datasets
    if (useWorker) {
      const skeletonCount = Math.min(12, Math.max(8, Math.floor(totalTaskCount / 50)));
      showTaskSkeletons(skeletonCount);
    } else {
      // Show skeleton only if we have a significant number to render (to improve perceived performance)
      const filteredCount = getFilteredTasksSync(state).length; // Quick estimate
      if (filteredCount > 30) {
        showTaskSkeletons(Math.min(8, Math.ceil(filteredCount / 10)));
      }
    }
    
    // Get filtered tasks either via worker or sync
    let filteredTasks;
    if (useWorker) {
      // Offload to worker
      try {
        filteredTasks = await getFilteredTasksAsync(state);
      } catch (error) {
        console.error('[Dashboard] Worker failed, falling back to sync:', error);
        showNotice('Performance optimization failed, using slower method.', 'error');
        filteredTasks = getFilteredTasksSync(state);
      }
    } else {
      // Use synchronous filter
      filteredTasks = getFilteredTasksSync(state);
    }
    
    // Render the filtered tasks
    dom.emptyState.style.display = 'none';
    
    // Choose rendering method based on count
    if (filteredTasks.length <= 100) {
      // Use normal DOM rendering
      if (virtualScroller) {
        virtualScroller.destroy();
        virtualScroller = null;
        isVirtualScrolling = false;
        dom.taskList.style = '';
      }
      renderTasksDOM(filteredTasks);
    } else {
      // Use virtual scrolling for large lists
      await renderTasksVirtualDOM(filteredTasks);
    }
  } catch (error) {
    console.error('[Dashboard] renderTasksWithSkeleton failed:', error);
    dom.taskList.innerHTML = '';
    dom.emptyState.style.display = 'block';
    dom.emptyMessage.textContent = 'Task list failed to render. Please refresh.';
    showNotice('Task list failed to render. Please refresh.', 'error');
  }
}

/**
 * Render tasks using normal DOM (batched).
 * @param {Object[]} tasks - Filtered task list.
 * @returns {void}
 */
function renderTasksDOM(tasks) {
  // Recycle existing task elements to reduce garbage collection
  recycleAllTaskItems();
  
  if (tasks.length === 0) {
    dom.emptyState.style.display = 'block';
    dom.emptyMessage.textContent = 'No tasks match current filters.';
    return;
  }
  
  dom.emptyState.style.display = 'none';
  
  const fragment = document.createDocumentFragment();
  const chunkSize = 25;
  
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const chunk = tasks.slice(i, i + chunkSize);
    chunk.forEach(task => {
      fragment.appendChild(createTaskElement(task));
    });
    
    // Yield to browser periodically for large sets
    if (tasks.length > 50 && i % (chunkSize * 2) === 0) {
      // Small yield without full async
      if (window.requestIdleCallback) {
        window.requestIdleCallback(() => {}, { timeout: 1 });
      }
    }
  }
  
  dom.taskList.appendChild(fragment);
}

/**
 * Render tasks using virtual scrolling.
 * @param {Object[]} tasks - Filtered task list.
 * @returns {Promise<void>}
 */
async function renderTasksVirtualDOM(tasks) {
  if (!virtualScroller) {
    // Clear container before init to remove any existing content (skeletons)
    dom.taskList.innerHTML = '';
    await initVirtualScroller();
  }
  
  if (virtualScroller) {
    virtualScroller.setItems(tasks);
  }
}

/**
 * Initialize virtual scroller for large datasets.
 * @returns {Promise<void>}
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
 * Render tasks using virtual scrolling.
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
 */
async function renderTasksVirtual(state) {
  const tasks = getFilteredTasksSync(state);
  
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
 * Debounced render tasks (for rapid successive updates).
 * @returns {Promise<void>}
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
 * Main render tasks function (called by syncUI).
 * @returns {Promise<void>}
 */
async function renderTasks() {
  try {
    const state = await getState();
    await renderTasksWithSkeleton(state);
  } catch (error) {
    console.error('[Dashboard] renderTasks failed:', error);
    showNotice('Failed to render tasks.', 'error');
  }
}

/**
 * Render timeline view with lazy loading.
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
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
  // Dynamic import for board view
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

  // Determine project ID: use from state if set, otherwise fetch projects
  let projectId = state.project_id;
  if (!projectId) {
    try {
      const projectsRes = await fetch('/api/projects');
      if (!projectsRes.ok) throw new Error('Failed to fetch projects');
      const projects = await projectsRes.json();
      if (projects.length === 0) throw new Error('No projects found');
      projectId = projects[0].id;
      state.project_id = projectId;
      await setState(state);
    } catch (e) {
      console.error('[Dashboard] Failed to get project for board:', e);
      showNotice('No project available for board view.', 'error');
      await renderTasksWithSkeleton(state);
      return;
    }
  }

  try {
    const board = new BoardView(dom.taskList);
    await board.setProjectId(projectId);
    console.log('[Dashboard] Board view initialized');
  } catch (error) {
    console.error('[Dashboard] Board view rendering failed:', error);
    showNotice('Failed to render board view. Showing list view.', 'error');
    await renderTasksWithSkeleton(state);
  }
}

/**
 * Render audit view.
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
 */
async function renderAuditView(state) {
  // Dynamic import for audit view
  if (!AuditView) {
    try {
      const module = await import('./audit-view.mjs');
      AuditView = module.AuditView || module.default;
    } catch (error) {
      console.error('[Dashboard] Failed to load audit view:', error);
      showNotice('Audit view unavailable. Showing list view.', 'error');
      await renderTasksWithSkeleton(state);
      return;
    }
  }

  try {
    const audit = new AuditView(dom.taskList);
    // Optionally load with filters from UI (actor, action, date range)
    const filters = {};
    // Could add UI filters later; for now load recent entries
    await audit.load(filters);
    console.log('[Dashboard] Audit view initialized');
  } catch (error) {
    console.error('[Dashboard] Audit view rendering failed:', error);
    showNotice('Failed to render audit view. Showing list view.', 'error');
    await renderTasksWithSkeleton(state);
  }
}

/**
 * Get filtered tasks using worker for large datasets, or sync for small.
 * @param {Object} state - Current state object.
 * @returns {Object[]|null} Filtered tasks or null if worker should be used.
 */
function getFilteredTasks(state) {
  // Use worker for large datasets (>200 tasks) to avoid main thread blocking
  if (workerAvailable && state.tasks.length > 200) {
    // We'll handle this asynchronously in renderTasksDebounced
    return null; // Signal to use worker
  }
  
  // Small datasets - use sync version
  return getFilteredTasksSync(state);
}

/**
 * Get filtered tasks asynchronously via worker.
 * @param {Object} state - Current state object.
 * @returns {Promise<Object[]>} Filtered task list.
 */
async function getFilteredTasksAsync(state) {
  return new Promise((resolve, reject) => {
    // Cancel any pending to avoid race conditions
    if (pendingFilterSortResolve) {
      console.warn('[Dashboard] Cancelling pending worker request');
      // Previous request timed out or orphaned, ignore its result
      pendingFilterSortResolve = null;
    }
    
    const timeoutMs = 10000;
    const timeoutId = setTimeout(() => {
      pendingFilterSortResolve = null;
      const err = new Error('Worker timeout after ' + timeoutMs + 'ms');
      console.error('[Dashboard]', err.message);
      reject(err);
    }, timeoutMs);
    
    pendingFilterSortResolve = (result) => {
      clearTimeout(timeoutId);
      console.log('[Dashboard] Worker response received, resolving with', result.length, 'tasks');
      resolve(result);
    };
    
    console.log('[Dashboard] Sending filter/sort to worker with', state.tasks.length, 'tasks');
    dashboardWorker.postMessage({
      type: 'FILTER_AND_SORT',
      data: {
        filter: state.filter,
        categoryFilter: state.categoryFilter,
        search: state.search,
        sort: state.sort,
        tasks: state.tasks,
        currentAgent: currentAgent,
        _duration: 0 // Will be set by worker
      }
    });
  });
}

/**
 * Compute a hash key for filter criteria (for memoization).
 * @param {Object} state - Current state object.
 * @returns {string} Filter hash.
 */
function computeFilterHash(state) {
  // Include currentAgent to distinguish my_tasks filter results per agent
  return `${state.filter}|${state.categoryFilter}|${state.search}|${state.sort}|${currentAgent || ''}`;
}

/**
 * Get filtered tasks synchronously (for rendering or small datasets).
 * Uses memoization to avoid recomputation when state hasn't changed.
 * @param {Object} state - Current state object.
 * @returns {Object[]} Filtered task list.
 */
function getFilteredTasksSync(state) {
  const filterHash = computeFilterHash(state);
  
  // Invalidate cache if tasks changed
  if (state.tasks.length !== lastTaskCount) {
    filterCache.clear();
    lastTaskCount = state.tasks.length;
  }
  
  // Check cache if the filter criteria haven't changed
  if (filterHash === lastFilterHash && filterCache.has(filterHash)) {
    return filterCache.get(filterHash);
  }
  
  let filtered = state.tasks;

  // Filter by status - support both legacy completed boolean and new status field
  if (state.filter === 'pending') {
    filtered = filtered.filter(task => {
      // Prefer status-based check; fallback to completed boolean
      if (task.status) {
        return !['completed', 'archived'].includes(task.status);
      }
      return !task.completed;
    });
  } else if (state.filter === 'completed') {
    filtered = filtered.filter(task => {
      if (task.status) {
        return task.status === 'completed' || task.status === 'archived';
      }
      return task.completed;
    });
  } else if (state.filter === 'my_tasks') {
    // Filter tasks assigned to current agent
    if (currentAgent) {
      filtered = filtered.filter(task => task.owner === currentAgent);
    } else {
      filtered = []; // no agent selected, show nothing
    }
  } else if (state.filter === 'overdue') {
    const now = new Date();
    filtered = filtered.filter(task => {
      // Exclude completed/archived
      const isCompleted = task.status ? ['completed','archived'].includes(task.status) : task.completed;
      if (isCompleted) return false;
      if (!task.due_date) return false;
      try {
        return new Date(task.due_date) < now;
      } catch (e) {
        return false;
      }
    });
  } else if (state.filter === 'blocked') {
    // Build a map of all tasks for dependency lookup
    const taskById = new Map();
    state.tasks.forEach(t => taskById.set(t.id, t));
    filtered = filtered.filter(task => {
      if (task.status === 'blocked') return true;
      if (task.dependency_ids && task.dependency_ids.length > 0) {
        for (const depId of task.dependency_ids) {
          const dep = taskById.get(depId);
          if (dep) {
            const depCompleted = dep.status ? ['completed','archived'].includes(dep.status) : dep.completed;
            if (!depCompleted) return true;
          }
        }
      }
      return false;
    });
  } else if (state.filter === 'no_due_date') {
    filtered = filtered.filter(task => !task.due_date);
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
    case 'status':
      // Define a typical workflow order
      const statusOrder = ['backlog','ready','in_progress','blocked','review','completed','archived'];
      sorted.sort((a,b) => {
        const idxA = statusOrder.indexOf(a.status || 'backlog');
        const idxB = statusOrder.indexOf(b.status || 'backlog');
        const safeA = idxA === -1 ? 999 : idxA;
        const safeB = idxB === -1 ? 999 : idxB;
        return safeA - safeB;
      });
      break;
    case 'owner':
      sorted.sort((a,b) => {
        const nameA = (a.owner || '').toLowerCase();
        const nameB = (b.owner || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
      break;
    case 'dependencies':
      sorted.sort((a,b) => {
        const depsA = a.dependency_ids ? a.dependency_ids.length : 0;
        const depsB = b.dependency_ids ? b.dependency_ids.length : 0;
        return depsA - depsB;
      });
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // Update cache
  lastFilterHash = filterHash;
  filterCache.set(filterHash, sorted);
  
  // Limit cache size to prevent memory issues (keep last 10)
  if (filterCache.size > 10) {
    const firstKey = filterCache.keys().next().value;
    filterCache.delete(firstKey);
  }

  return sorted;
}

/**
 * Compute visible hierarchy from filtered tasks based on parent-child relationships and expansion state.
 * Returns an array of tasks with metadata: __depth, __hasChildren, __isExpanded, __childStats.
 * @param {Object[]} tasks - Filtered task list.
 * @param {Set<string|number>} expandedIds - Expanded task IDs.
 * @returns {Object[]} Visible task hierarchy.
 */
function computeVisibleHierarchy(tasks, expandedTaskIds) {
  const taskMap = new Map();
  const childrenMap = new Map();

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
    const completed = children.filter(c => c.completed).length;
    childStatsMap.set(parentId, { total: children.length, completed });
  });

  const visible = [];

  function traverse(taskId, depth) {
    const task = taskMap.get(taskId);
    if (!task) return;

    // Create a shallow copy to avoid mutating original task
    const visibleTask = { ...task };
    visibleTask.__depth = depth;
    visibleTask.__hasChildren = childrenMap.has(taskId);
    visibleTask.__isExpanded = expandedTaskIds.has(taskId);
    visibleTask.__childStats = childStatsMap.get(taskId) || null;

    visible.push(visibleTask);

    if (visibleTask.__isExpanded && visibleTask.__hasChildren) {
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
 * Render worker results (async filtering done in worker).
 * @param {Object[]} result - Filtered task list.
 * @returns {Promise<void>}
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
 * Show task skeletons during loading.
 * @param {number} [count=8] - Number of skeletons to show.
 * @returns {void}
 */
function showTaskSkeletons(count = 8) {
  dom.emptyState.style.display = 'none';
  recycleAllTaskItems();
  const skeletons = skeletonLoader.createTaskSkeletons(count);
  dom.taskList.appendChild(skeletons);
}

/**
 * Create a task element (read mode) with memoization.
 * @param {Object} task - Task object.
 * @returns {HTMLElement} Task element.
 */
function createTaskElement(task) {
  // If this task is being edited, render edit form
  if (editingId === task.id) {
    return createEditForm(task);
  }

  // Check if we have a recycled element
  let element = taskPool.pop();
  
  if (!element) {
    // Create new element
    const main = document.createElement('div');
    main.className = 'task-main';

    const text = document.createElement('span');
    text.className = 'task-text';
    
    const meta = document.createElement('span');
    meta.className = 'task-meta';

    const category = document.createElement('span');
    category.className = 'category-badge';
    
    const dates = document.createElement('span');

    meta.append(category, dates);

    // Owner quick-assign chip
    const ownerChip = document.createElement('span');
    ownerChip.className = 'owner-chip';
    if (task.owner) {
      ownerChip.textContent = task.owner;
      const removeX = document.createElement('span');
      removeX.className = 'remove';
      removeX.textContent = '×';
      removeX.onclick = (e) => {
        e.stopPropagation();
        updateTask(task.id, { owner: null });
      };
      ownerChip.appendChild(removeX);
      ownerChip.onclick = (e) => {
        e.stopPropagation();
        showOwnerMenu(task.id, ownerChip);
      };
    } else {
      ownerChip.textContent = '+';
      ownerChip.title = 'Assign to agent';
      ownerChip.onclick = (e) => {
        e.stopPropagation();
        showOwnerMenu(task.id, ownerChip);
      };
    }
    meta.appendChild(ownerChip);
    main.append(text, meta);

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const completeBtn = createActionButton('Done', 'complete-btn', () => toggleTask(task.id));
    const editBtn = createActionButton('Edit', 'edit-btn', () => startEdit(task.id));
    const deleteBtn = createActionButton('Delete', 'delete-btn', () => deleteTaskById(task.id));

    actions.append(completeBtn, editBtn, deleteBtn);

    const container = document.createElement('div');
    container.style.display = 'contents';
    container.className = 'task-item';
    container.setAttribute('role', 'button');
    container.setAttribute('tabindex', '0');
    container.append(main, actions);

    // Add priority border class
    container.classList.add('priority-' + (task.priority || 'medium'));

    // Check for overdue
    if (task.due_date) {
      const now = new Date();
      const due = new Date(task.due_date);
      const isCompleted = task.status ? task.status === 'completed' : Boolean(task.completed);
      if (!isCompleted && due < now) {
        container.classList.add('overdue');
      }
    }
    
    element = {
      container,
      main,
      text,
      meta,
      category,
      dates,
      actions,
      completeBtn,
      editBtn,
      deleteBtn
    };
  }

  // Populate with task data
  element.text.textContent = task.text;
  element.category.textContent = task.category || 'General';
  element.dates.textContent = `Created ${formatDate(task.createdAt)}${task.updatedAt ? ` • Updated ${formatDate(task.updatedAt)}` : ''}`;
  element.container.dataset.taskId = String(task.id);
  
  // Determine completed status from either status or completed boolean
  const isCompleted = task.status ? 
    (task.status === 'completed' || task.status === 'archived') : 
    Boolean(task.completed);
  
  if (isCompleted) {
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

  // Accessibility labels
  element.container.setAttribute('aria-pressed', isCompleted ? 'true' : 'false');
  element.container.setAttribute('aria-label', `Toggle task: ${task.text}`);
  element.completeBtn.setAttribute('aria-label', `${isCompleted ? 'Mark task as incomplete' : 'Mark task as complete'}: ${task.text}`);
  element.editBtn.setAttribute('aria-label', `Edit task: ${task.text}`);
  element.deleteBtn.setAttribute('aria-label', `Delete task: ${task.text}`);

  // Attach wrapper to container for recycling
  element.container._dashboardWrapper = element;

  // Return the container element (not the wrapper object)
  return element.container;
}

/**
 * Recycle all task elements currently in the DOM.
 * Moves them to the pool for reuse, preserving wrapper references.
 * @returns {void}
 */
function recycleAllTaskItems() {
  // Detach all child nodes of taskList and add their wrappers to the pool
  while (dom.taskList.firstChild) {
    const child = dom.taskList.firstChild;
    dom.taskList.removeChild(child);
    const wrapper = child._dashboardWrapper;
    if (wrapper) {
      taskPool.push(wrapper);
    }
  }
}

/**
 * Create an action button.
 * @param {string} text - Button text.
 * @param {string} className - Button class.
 * @param {Function|null} onClick - Click handler (optional).
 * @param {boolean} [ariaPressed=false] - aria-pressed value.
 * @param {string} [ariaLabel] - Accessible label.
 * @returns {HTMLButtonElement} Button element.
 */
function createActionButton(text, className, onClick, ariaPressed = false, ariaLabel) {
  const btn = document.createElement('button');
  btn.className = `action-btn ${className}`;
  btn.type = 'button';
  btn.textContent = text;
  btn.setAttribute('aria-pressed', ariaPressed);
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
  btn.dataset.action = className.split('-')[0];
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Render view with skeleton loading.
 * @param {string} view - View name.
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
 */
async function renderViewSwitch(view, state) {
  try {
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
    
    // Stop agent heartbeat when leaving agent view
    if (view !== 'agent') {
      stopAgentHeartbeat();
    }
    
    // Reset task list styles
    dom.taskList.style = '';
    dom.taskList.innerHTML = '';
    
    if (view === 'list') {
      // Render tasks (with virtual scrolling if needed)
      await renderTasksWithSkeleton(state);
    } else if (view === 'board') {
      // Initialize board view
      await renderBoardView(state);
    } else if (view === 'timeline') {
      // Initialize timeline view with lazy loading
      await renderTimelineView(state);
    } else if (view === 'agent') {
      // Initialize agent view
      await renderAgentView(state);
    } else if (view === 'audit') {
      await renderAuditView(state);
    } else {
      // Unknown view - use list view as fallback
      console.log(`[Dashboard] View '${view}' not fully implemented, showing list view`);
      await renderTasksWithSkeleton(state);
    }
    
    updateViewButtons(state);
    
    // Show/hide agent UI container
    const agentContainer = document.getElementById('agentUIContainer');
    if (agentContainer) {
      agentContainer.style.display = (view === 'agent') ? 'block' : 'none';
    }
  } catch (error) {
    console.error('[Dashboard] renderViewSwitch failed:', error);
    showNotice('Failed to switch views. Please refresh.', 'error');
  }
}

/**
 * Update stats display (optimized to batch DOM updates).
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
 */
async function updateStats(state) {
  // Filter to active tasks only (exclude archived)
  const activeTasks = state.tasks.filter(t => {
    if (t.status === 'archived') return false;
    if (t.archived) return false;
    return true;
  });

  const total = activeTasks.length;
  const completed = activeTasks.filter(t => {
    if (t.status) return t.status === 'completed';
    return t.completed === true;
  }).length;
  const pending = total - completed;

  // Quick filter counts (over active tasks only)
  const now = new Date();
  let myTasksCount = 0;
  let overdueCount = 0;
  let blockedCount = 0;
  let noDueDateCount = 0;

  // Build a map for dependency lookups (for blocked count)
  const taskById = new Map();
  activeTasks.forEach(t => taskById.set(t.id, t));

  activeTasks.forEach(task => {
    // My tasks: owner matches currentAgent
    if (currentAgent && task.owner === currentAgent) {
      myTasksCount++;
    }

    // Overdue: due date in the past and not completed
    if (task.due_date) {
      try {
        const due = new Date(task.due_date);
        if (due < now) {
          const isCompleted = task.status ? task.status === 'completed' : task.completed;
          if (!isCompleted) overdueCount++;
        }
      } catch (e) {
        // Invalid date, skip
      }
    }

    // No due date
    if (!task.due_date) {
      noDueDateCount++;
    }

    // Blocked: status='blocked' OR incomplete dependencies
    if (task.status === 'blocked') {
      blockedCount++;
    } else if (task.dependency_ids && task.dependency_ids.length > 0) {
      // Check if any dependency is not completed
      for (const depId of task.dependency_ids) {
        const dep = taskById.get(depId);
        if (dep) {
          const depCompleted = dep.status ? dep.status === 'completed' : dep.completed;
          if (!depCompleted) {
            blockedCount++;
            break;
          }
        }
      }
    }
  });

  // Batch update
  dom.totalTasks.textContent = total;
  dom.completedTasks.textContent = completed;
  dom.pendingTasks.textContent = pending;

  dom.filterAllCount.textContent = total;
  dom.filterPendingCount.textContent = pending;
  dom.filterCompletedCount.textContent = completed;
  dom.filterMyTasksCount?.textContent = myTasksCount;
  dom.filterOverdueCount?.textContent = overdueCount;
  dom.filterBlockedCount?.textContent = blockedCount;
  dom.filterNoDueDateCount?.textContent = noDueDateCount;
}

/**
 * Update filter buttons state.
 * @param {Object} state - Current state object.
 * @returns {void}
 */
function updateFilterButtons(state) {
  dom.filterButtons.forEach(button => {
    const isActive = button.dataset.filter === state.filter;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

/**
 * Update search and sort UI to match state.
 * @param {Object} state - Current state object.
 * @returns {void}
 */
function updateSearchSortUI(state) {
  dom.searchInput.value = state.search || '';
  dom.sortSelect.value = state.sort || 'newest';
}

/**
 * Update theme UI.
 * @param {{theme: string}} state - State-like object with theme.
 * @returns {void}
 */
function updateThemeUI(state) {
  document.documentElement.setAttribute('data-theme', state.theme);
  const isDark = state.theme === 'dark';
  dom.themeIcon.textContent = isDark ? '☀️' : '🌙';
  dom.themeLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
  dom.themeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
  dom.themeToggle.setAttribute('aria-label', 'Toggle theme');
}

/**
 * Update view buttons state.
 * @param {Object} state - Current state object.
 * @returns {void}
 */
function updateViewButtons(state) {
  document.querySelectorAll('.view-btn').forEach(btn => {
    const isActive = btn.dataset.view === (state?.view || 'list');
    btn.setAttribute('aria-pressed', isActive);
  });
}

/**
 * Update Pause button UI based on agentPaused state.
 * @returns {void}
 */
function updateAgentPauseUI() {
  const pauseBtn = document.getElementById('agentPauseBtn');
  if (pauseBtn) {
    pauseBtn.textContent = agentPaused ? 'Resume' : 'Pause';
    pauseBtn.style.background = agentPaused ? 'rgba(239, 68, 68, 0.12)' : '';
    pauseBtn.style.color = agentPaused ? 'var(--accent-3)' : '';
  }
}

/**
 * Show a notice message.
 * @param {string} message - Message text.
 * @param {'info'|'success'|'error'} [type='info'] - Notice type.
 * @returns {void}
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

/**
 * Handle delegated task list clicks.
 * @param {MouseEvent} event - Click event.
 * @returns {void}
 */
function handleTaskListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || !dom.taskList.contains(button)) return;

  const taskItem = button.closest('.task-item');
  const taskId = taskItem?.dataset?.taskId;
  if (!taskId) return;

  switch (button.dataset.action) {
    case 'complete':
      handleToggleTask(taskId);
      break;
    case 'edit':
      startEdit(taskId);
      break;
    case 'delete':
      deleteTaskById(taskId);
      break;
    default:
      break;
  }
}

/**
 * Handle delegated keydown events for task items.
 * @param {KeyboardEvent} event - Keydown event.
 * @returns {void}
 */
function handleTaskListKeydown(event) {
  if (event.target.closest('button, input, textarea, select')) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;

  const taskItem = event.target.closest('.task-item');
  if (!taskItem || event.target !== taskItem) return;

  event.preventDefault();
  const taskId = taskItem.dataset?.taskId;
  if (taskId) {
    handleToggleTask(taskId);
  }
}

/**
 * Toggle task completion with performance tracking.
 * @param {number|string} id - Task ID.
 * @returns {Promise<void>}
 */
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

/**
 * Enter edit mode for a task.
 * @param {number|string} id - Task ID.
 * @returns {Promise<void>}
 */
async function startEdit(id) {
  const state = await getState();
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  editingId = id;
  editingText = task.text;
  editingCategory = task.category || 'General';
  editingStatus = task.status || 'backlog';
  editingPriority = task.priority || 'medium';
  editingOwner = task.owner || '';
  editingStartDate = task.start_date || '';
  editingDueDate = task.due_date || '';
  renderTasks();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-edit-input="${id}"]`);
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

/**
 * Save the current edit state.
 * @param {number|string} id - Task ID.
 * @returns {Promise<void>}
 */
async function saveEdit(id) {
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
      title: editingText.trim(), // also set title consistency
      category: editingCategory,
      status: editingStatus,
      priority: editingPriority,
      owner: editingOwner || null,
      start_date: editingStartDate || null,
      due_date: editingDueDate || null
    });
    editingId = null;
    editingText = '';
    editingCategory = '';
    editingStatus = '';
    editingPriority = 'medium';
    editingOwner = '';
    editingStartDate = '';
    editingDueDate = '';
    showNotice('Task updated.', 'success');
    const duration = performance.now() - startTime;
    performanceMonitor.record('update-task', duration);
  } catch (error) {
    showNotice('Failed to update task.', 'error');
  } finally {
    skeletonLoader.clearButtonLoading(document.querySelector('[data-action="save"]'));
  }
}

/**
 * Cancel edit mode and re-render.
 * @returns {void}
 */
function cancelEdit() {
  editingId = null;
  editingText = '';
  editingCategory = '';
  editingStatus = '';
  editingPriority = 'medium';
  editingOwner = '';
  editingStartDate = '';
  editingDueDate = '';
  renderTasks();
}

/**
 * Delete a task by ID.
 * @param {number|string} id - Task ID.
 * @returns {Promise<void>}
 */
async function deleteTaskById(id) {
  const state = await getState();
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (confirm(`Delete "${task.text}"?`)) {
    const taskCopy = { ...task };
    try {
      await deleteTask(id);
      // Add to undo stack
      undoStack.unshift({ type: 'delete', task: taskCopy });
      showUndoSnackbar('Task deleted', () => {
        getState().then(currentState => {
          currentState.tasks.unshift(taskCopy);
          setState(currentState).then(() => renderTasks());
        });
      });
      showNotice('Task deleted.', 'success');
    } catch (error) {
      showNotice('Failed to delete task.', 'error');
    }
  }
}

// ==================== Export/Import ====================

/**
 * Export tasks as JSON.
 * @returns {void}
 */
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

/**
 * Export tasks as CSV.
 * @returns {void}
 */
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

/**
 * Trigger file download.
 * @param {string} content - File contents.
 * @param {string} filename - File name.
 * @param {string} mimeType - MIME type.
 * @returns {void}
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Handle task import from file input.
 * @param {Event} event - Change event.
 * @returns {void}
 */
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
        if (task.text) {
          await addTask(task.text, task.category);
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

/**
 * Parse CSV content to task objects.
 * @param {string} csv - CSV content.
 * @returns {Object[]} Parsed task list.
 */
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
 * Format date for display.
 * @param {string} isoString - ISO date string.
 * @returns {string} Formatted date.
 */
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
 * @returns {Object} Cached or empty state.
 */
function getStateSync() {
  // This is a simplified sync version - in reality we'd need to track state locally
  // For now, return cached state or empty
  return window.dashboardDebug?.getState
    ? window.dashboardDebug.getState()
    : { tasks: [], categories: [] };
}

// ==================== AGENT VIEW ====================

/**
 * Render Agent View.
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
 */
async function renderAgentView(state) {
  try {
    // Stop any existing heartbeat
    stopAgentHeartbeat();
    
    // Fetch available agents if not already loaded
    let agents = window.availableAgents || [];
    if (agents.length === 0) {
      try {
        const agentsRes = await fetch('/api/agents');
        const agentsData = await agentsRes.json();
        agents = agentsData.agents || [];
        window.availableAgents = agents;
      } catch (error) {
        console.error('[Dashboard] Failed to fetch agents:', error);
        agents = ['openclaw']; // Default fallback
      }
    }
    
    // Build agent selector if not exists
    if (!dom.agentSelect) {
      buildAgentUI(agents);
    }
    
    // Select default agent if none selected
    if (!currentAgent && agents.length > 0) {
      currentAgent = agents[0];
      dom.agentSelect.value = currentAgent;
    }
    
    // Show agent view container
    dom.taskList.innerHTML = '';
    dom.emptyState.style.display = 'none';
    
    // Load agent tasks first, then render stats
    await loadAgentTasks(currentAgent);
    await renderAgentStats(currentAgent);
    
    // Start heartbeat refresh
    startAgentHeartbeat();
  } catch (error) {
    console.error('[Dashboard] renderAgentView failed:', error);
    showNotice('Failed to render agent view.', 'error');
  }
}

/**
 * Build Agent View UI elements.
 * @param {string[]} agents - Available agent list.
 * @returns {void}
 */
function buildAgentUI(agents) {
  // Create container for agent UI (selector + stats)
  const agentUIContainer = document.createElement('div');
  agentUIContainer.id = 'agentUIContainer';
  agentUIContainer.style.cssText = 'display: block;';
  
  // Create agent selector
  const selectorContainer = document.createElement('div');
  selectorContainer.className = 'agent-selector';
  selectorContainer.style.cssText = 'margin-bottom: 20px; display: flex; gap: 12px; align-items: center;';
  
  const label = document.createElement('label');
  label.textContent = 'Agent:';
  label.setAttribute('for', 'agentSelect');
  label.style.fontWeight = '600';
  
  const select = document.createElement('select');
  select.id = 'agentSelect';
  select.className = 'agent-select';
  select.style.cssText = 'padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text);';
  
  agents.forEach(agent => {
    const option = document.createElement('option');
    option.value = agent;
    option.textContent = agent;
    select.appendChild(option);
  });
  
  select.addEventListener('change', async (e) => {
    currentAgent = e.target.value;
    await loadAgentTasks(currentAgent);
    await renderAgentStats(currentAgent);
    // Refresh main task list and stats to reflect agent filter changes
    await renderTasks();
    const state = await getState();
    await updateStats(state);
  });
  
  selectorContainer.appendChild(label);
  selectorContainer.appendChild(select);

  // Create pause/resume button for agent heartbeat
  const pauseBtn = document.createElement('button');
  pauseBtn.id = 'agentPauseBtn';
  pauseBtn.className = 'secondary-btn';
  pauseBtn.type = 'button';
  pauseBtn.textContent = 'Pause';
  pauseBtn.style.marginLeft = '8px';
  pauseBtn.setAttribute('aria-label', 'Pause agent updates');

  // Initialize pause state from localStorage
  try {
    agentPaused = localStorage.getItem('dashboard_agent_paused') === 'true';
  } catch (error) {
    agentPaused = false;
  }
  updateAgentPauseUI();

  pauseBtn.addEventListener('click', async () => {
    agentPaused = !agentPaused;
    try {
      localStorage.setItem('dashboard_agent_paused', agentPaused);
    } catch (error) {
      console.warn('[Dashboard] Failed to persist agent pause state:', error);
    }
    updateAgentPauseUI();
    if (agentPaused) {
      stopAgentHeartbeat();
      showNotice('Agent updates paused.', 'info');
    } else {
      await startAgentHeartbeat();
      showNotice('Agent updates resumed.', 'success');
    }
  });

  selectorContainer.appendChild(pauseBtn);
  agentUIContainer.appendChild(selectorContainer);
  
  // Create stats container
  const statsContainer = document.createElement('div');
  statsContainer.id = 'agentStatsContainer';
  statsContainer.className = 'stats';
  statsContainer.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px;';
  agentUIContainer.appendChild(statsContainer);
  
  // Insert container before task list
  dom.taskList.parentNode.insertBefore(agentUIContainer, dom.taskList);
  
  // Store references
  dom.agentSelect = select;
  dom.agentStatsContainer = statsContainer;
}

/**
 * Render agent statistics.
 * @param {string} agentName - Current agent name.
 * @returns {Promise<void>}
 */
async function renderAgentStats(agentName) {
  if (!dom.agentStatsContainer) return;
  
  // Show skeleton loading
  dom.agentStatsContainer.innerHTML = '';
  const skeleton = skeletonLoader.createStatsSkeletons(3);
  dom.agentStatsContainer.appendChild(skeleton);
  
  try {
    // We'll compute stats from agent tasks
    const tasks = agentTasks;
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed' || t.status === 'archived').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const ready = tasks.filter(t => t.status === 'ready').length;
    const locked = tasks.filter(t => t.lockedBy === agentName).length;
    
    const stats = [
      { label: 'Total Tasks', value: total },
      { label: 'Ready', value: ready },
      { label: 'In Progress', value: inProgress },
      { label: 'Completed', value: completed },
      { label: 'Locked by Me', value: locked }
    ];
    
    // Render stats cards
    dom.agentStatsContainer.innerHTML = '';
    stats.forEach(stat => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `
        <h3 style="color: var(--accent); margin-bottom: 6px; font-size: 2rem;">${stat.value}</h3>
        <p style="color: var(--muted); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1.2px;">${stat.label}</p>
      `;
      dom.agentStatsContainer.appendChild(card);
    });
  } catch (error) {
    console.error('[Dashboard] Failed to render agent stats:', error);
    dom.agentStatsContainer.innerHTML = '<div class="empty-state"><p>Failed to load stats.</p></div>';
  }
}

/**
 * Load agent tasks from API.
 * @param {string} agentName - Agent name.
 * @param {number} [page=1] - Page number.
 * @param {number} [limit=50] - Page size.
 * @returns {Promise<void>}
 */
async function loadAgentTasks(agentName, page = 1, limit = 50) {
  try {
    const url = `/api/views/agent?agent_name=${encodeURIComponent(agentName)}&page=${page}&limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    const data = await response.json();
    
    agentTasks = data.tasks || [];
    
    // Render tasks (no virtual scrolling for agent view - typically small)
    renderAgentTaskList(agentTasks, agentName);
    
  } catch (error) {
    console.error('[Dashboard] Failed to load agent tasks:', error);
    showNotice('Failed to load agent queue.', 'error');
  }
}

/**
 * Render agent task list.
 * @param {Object[]} tasks - Task list.
 * @param {string} agentName - Agent name.
 * @returns {void}
 */
function renderAgentTaskList(tasks, agentName) {
  if (!dom.taskList) return;
  
  dom.taskList.innerHTML = '';
  
  if (tasks.length === 0) {
    dom.emptyState.style.display = 'block';
    dom.emptyMessage.textContent = `No tasks assigned to ${agentName}.`;
    return;
  }
  
  dom.emptyState.style.display = 'none';
  
  const fragment = document.createDocumentFragment();
  tasks.forEach(task => {
    const element = createAgentTaskElement(task, agentName);
    fragment.appendChild(element);
  });
  
  dom.taskList.appendChild(fragment);
}

/**
 * Create an agent task element.
 * @param {Object} task - Agent task object.
 * @param {string} agentName - Current agent name.
 * @returns {HTMLElement} Agent task element.
 */
function createAgentTaskElement(task, agentName) {
  const container = document.createElement('div');
  container.className = 'agent-task-item task-item';
  container.dataset.taskId = task.id;
  
  const isLocked = task.lockedBy === agentName;
  
  // Status badge
  const statusBadge = document.createElement('span');
  statusBadge.className = 'category-badge';
  statusBadge.textContent = task.status || 'unknown';
  statusBadge.style.cssText = `background: ${getStatusColor(task.status)}; color: white;`;
  
  // Task text
  const textEl = document.createElement('div');
  textEl.className = 'task-text';
  textEl.textContent = task.title || task.text;
  textEl.style.fontSize = '1.05rem';
  textEl.style.marginBottom = '8px';
  
  // Meta info
  const meta = document.createElement('div');
  meta.className = 'agent-task-meta';
  meta.style.fontSize = '0.85rem';
  meta.style.color = 'var(--muted)';
  
  if (task.project_name) {
    const projectSpan = document.createElement('span');
    projectSpan.textContent = `📁 ${task.project_name}`;
    meta.appendChild(projectSpan);
  }
  
  if (task.priority) {
    const prioritySpan = document.createElement('span');
    prioritySpan.textContent = `Priority: ${task.priority}`;
    meta.appendChild(prioritySpan);
  }
  
  if (isLocked) {
    const lockSpan = document.createElement('span');
    lockSpan.textContent = '🔒 Locked';
    lockSpan.style.color = 'var(--accent-3)';
    lockSpan.style.fontWeight = '600';
    meta.appendChild(lockSpan);
  }
  
  // Actions
  const actions = document.createElement('div');
  actions.className = 'agent-task-actions';
  
  if (isLocked) {
    // Release button
    const releaseBtn = document.createElement('button');
    releaseBtn.className = 'agent-action-btn release-btn';
    releaseBtn.textContent = 'Release';
    releaseBtn.setAttribute('aria-label', `Release task: ${task.title}`);
    releaseBtn.onclick = async () => {
      releaseBtn.disabled = true;
      releaseBtn.textContent = 'Releasing...';
      try {
        await releaseTask(task.id);
        await loadAgentTasks(agentName); // Refresh
      } catch (error) {
        showNotice('Failed to release task.', 'error');
        releaseBtn.disabled = false;
        releaseBtn.textContent = 'Release';
      }
    };
    actions.appendChild(releaseBtn);
    
    // Execute button
    const executeBtn = document.createElement('button');
    executeBtn.className = 'agent-action-btn';
    executeBtn.style.background = 'rgba(92, 107, 242, 0.18)';
    executeBtn.style.color = 'var(--accent)';
    executeBtn.textContent = 'Execute';
    executeBtn.setAttribute('aria-label', `Execute task: ${task.title}`);
    executeBtn.onclick = async () => {
      await executeTaskWithGuard(task, agentName, executeBtn);
    };
    actions.appendChild(executeBtn);
    
  } else {
    // Claim button
    const claimBtn = document.createElement('button');
    claimBtn.className = 'agent-action-btn claim-btn';
    claimBtn.textContent = 'Claim';
    claimBtn.setAttribute('aria-label', `Claim task: ${task.title}`);
    claimBtn.onclick = async () => {
      claimBtn.disabled = true;
      claimBtn.textContent = 'Claiming...';
      try {
        const result = await claimTask(task.id, agentName);
        if (result.locked) {
          await loadAgentTasks(agentName);
        } else {
          claimBtn.disabled = false;
          claimBtn.textContent = 'Claim';
          showNotice(result.error || 'Failed to claim task.', 'error');
        }
      } catch (error) {
        claimBtn.disabled = false;
        claimBtn.textContent = 'Claim';
        showNotice('Failed to claim task.', 'error');
      }
    };
    actions.appendChild(claimBtn);
  }
  
  // Add meta line after text
  const metaRow = document.createElement('div');
  metaRow.className = 'agent-task-meta-row';
  metaRow.style.display = 'flex';
  metaRow.style.gap = '12px';
  metaRow.style.marginTop = '4px';
  metaRow.appendChild(statusBadge);
  metaRow.appendChild(meta);
  
  container.appendChild(textEl);
  container.appendChild(metaRow);
  container.appendChild(actions);
  
  return container;
}

/**
 * Show pre-execution guard modal and return true if user confirms.
 * @param {Object} task - Task object.
 * @param {string} agentName - Agent name.
 * @returns {Promise<boolean>} True if confirmed.
 */
function showPreExecutionGuardModal(task, agentName) {
  return new Promise((resolve) => {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const modal = document.createElement('div');
    modal.style.cssText = 'background: var(--surface); border-radius: 16px; padding: 24px; max-width: 500px; width: 90%; box-shadow: var(--shadow);';

    const title = document.createElement('h3');
    title.textContent = 'Pre-Execution Guard';
    title.style.marginBottom = '12px';

    const checksList = document.createElement('ul');
    checksList.style.cssText = 'margin: 12px 0; padding-left: 20px;';

    // Perform checks
    const checks = [];

    // Check 1: Task status
    if (task.status === 'ready') {
      checks.push({ name: 'Task status is ready', pass: true });
    } else if (task.status === 'in_progress') {
      checks.push({ name: 'Task status is in_progress (already claimed)', pass: true });
    } else {
      checks.push({ name: `Task status is '${task.status}'`, pass: false, msg: 'Task must be ready or in_progress' });
    }

    // Check 2: Dependencies
    if (task.dependency_ids && task.dependency_ids.length > 0) {
      checks.push({ name: `Task has ${task.dependency_ids.length} dependency(s)`, pass: 'warning', msg: 'Ensure all dependencies are completed before execution.' });
    } else {
      checks.push({ name: 'No dependencies', pass: true });
    }

    // Check 3: Secrets (simple client-side check)
    const sensitivePattern = /(password|token|secret|api_key|apikey)\s*=/i;
    const textToCheck = (task.title || '') + ' ' + (task.description || '');
    if (sensitivePattern.test(textToCheck)) {
      checks.push({ name: 'Sensitive keyword detected', pass: false, msg: 'Task contains potential secret; redaction may be required.' });
    } else {
      checks.push({ name: 'No sensitive keywords detected', pass: true });
    }

    // Render checks
    checks.forEach(check => {
      const li = document.createElement('li');
      li.style.marginBottom = '8px';
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.gap = '8px';

      const icon = document.createElement('span');
      if (check.pass === true) {
        icon.textContent = '✅';
      } else if (check.pass === 'warning') {
        icon.textContent = '⚠️';
        icon.style.color = 'var(--accent-2)';
      } else {
        icon.textContent = '❌';
      }

      const text = document.createElement('span');
      text.textContent = check.name;
      if (!check.pass) text.style.color = 'var(--accent-3)';

      li.appendChild(icon);
      li.appendChild(text);

      if (check.msg) {
        const msg = document.createElement('small');
        msg.textContent = ` (${check.msg})`;
        msg.style.color = 'var(--muted)';
        li.appendChild(msg);
      }

      checksList.appendChild(li);
    });

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'secondary-btn';
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });

    const executeBtn = document.createElement('button');
    executeBtn.textContent = 'Execute';
    executeBtn.className = 'add-btn';
    executeBtn.type = 'button';
    executeBtn.disabled = checks.some(c => c.pass === false);
    executeBtn.addEventListener('click', async () => {
      overlay.remove();
      resolve(true);
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(executeBtn);

    modal.appendChild(title);
    modal.appendChild(checksList);
    modal.appendChild(actions);
    overlay.appendChild(modal);

    // Append to body and focus
    document.body.appendChild(overlay);
    executeBtn.focus();

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
        resolve(false);
      }
    };
    document.addEventListener('keydown', escHandler);
  });
}

/**
 * Execute task with pre-execution guard.
 * @param {Object} task - Task object.
 * @param {string} agentName - Agent name.
 * @param {HTMLButtonElement} button - Execute button element.
 * @returns {Promise<void>}
 */
async function executeTaskWithGuard(task, agentName, button) {
  button.disabled = true;
  const originalText = button.textContent;

  try {
    // Show pre-execution guard modal
    const confirmed = await showPreExecutionGuardModal(task, agentName);
    if (!confirmed) {
      button.disabled = false;
      button.textContent = originalText;
      return;
    }

    button.textContent = 'Claiming...';

    // Claim the task
    const claimRes = await claimTask(task.id, agentName);
    if (!claimRes.locked) {
      throw new Error(claimRes.error || 'Failed to claim task');
    }

    button.textContent = 'Executing...';

    // Execute task (update status)
    await executeTaskOnServer(task.id, agentName);

    showNotice(`Task "${task.title}" execution started.`, 'success');
    button.textContent = 'Running';

    // Refresh task list after delay
    setTimeout(async () => {
      await loadAgentTasks(agentName);
    }, 2000);

  } catch (error) {
    showNotice(`Execution failed: ${error.message}`, 'error');
    button.disabled = false;
    button.textContent = originalText;
  }
}

/**
 * Execute task on server (placeholder).
 * @param {string|number} taskId - Task ID.
 * @param {string} agentName - Agent name.
 * @returns {Promise<Object>} API response.
 */
async function executeTaskOnServer(taskId, agentName) {
  // This would integrate with OpenClaw's actual task execution
  // For now, we'll just update the task status to in_progress
  try {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' })
    });
    
    if (!response.ok) {
      throw new Error('Failed to update task status');
    }
    
    return await response.json();
  } catch (error) {
    throw error;
  }
}

/**
 * Claim task for agent execution.
 * @param {string|number} taskId - Task ID.
 * @param {string} agentName - Agent name.
 * @returns {Promise<Object>} API response.
 */
async function claimTask(taskId, agentName) {
  const response = await fetch('/api/agent/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, agent_name: agentName })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to claim task');
  }
  
  return await response.json();
}

/**
 * Release claimed task.
 * @param {string|number} taskId - Task ID.
 * @returns {Promise<Object>} API response.
 */
async function releaseTask(taskId) {
  const response = await fetch('/api/agent/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to release task');
  }
  
  return await response.json();
}

/**
 * Start agent heartbeat auto-refresh.
 * @returns {void}
 */
function startAgentHeartbeat() {
  if (agentPaused) {
    console.log('[Dashboard] Agent heartbeat is paused');
    return;
  }
  stopAgentHeartbeat(); // Clear any existing
  
  agentRefreshInterval = setInterval(async () => {
    if (currentAgent && currentView === 'agent') {
      console.log(`[Dashboard] Agent heartbeat: refreshing ${currentAgent}'s queue...`);
      await loadAgentTasks(currentAgent);
    }
  }, 30000); // 30 seconds
}

/**
 * Stop agent heartbeat.
 * @returns {void}
 */
function stopAgentHeartbeat() {
  if (agentRefreshInterval) {
    clearInterval(agentRefreshInterval);
    agentRefreshInterval = null;
  }
}

/**
 * Get status color for badge.
 * @param {string} status - Task status.
 * @returns {string} CSS color.
 */
function getStatusColor(status) {
  const colors = {
    'backlog': '#6b7280',
    'ready': '#3b82f6',
    'in_progress': '#f59e0b',
    'blocked': '#ef4444',
    'review': '#8b5cf6',
    'completed': '#20b26c',
    'archived': '#9ca3af'
  };
  return colors[status] || '#6b7280';
}

/**
 * Create edit form for a task.
 * @param {Object} task - Task object.
 * @returns {HTMLElement} Edit form wrapper.
 */
function createEditForm(task) {
  const wrapper = document.createElement('div');
  wrapper.className = 'task-item task-edit';

  // Use grid layout
  const grid = document.createElement('div');
  grid.className = 'edit-form-grid';

  // Text input
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.value = editingText || task.text;
  textInput.dataset.editInput = task.id;
  textInput.placeholder = 'Task title';
  textInput.addEventListener('input', (e) => editingText = e.target.value);
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEdit(task.id);
    if (e.key === 'Escape') cancelEdit();
  });

  // Category input with datalist
  const categoryInput = document.createElement('input');
  categoryInput.type = 'text';
  categoryInput.value = editingCategory || task.category || 'General';
  categoryInput.placeholder = 'Category';
  categoryInput.setAttribute('list', 'categoryOptions');
  categoryInput.addEventListener('input', (e) => editingCategory = e.target.value);

  // Status select
  const statusSelect = document.createElement('select');
  const statusOptions = ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'completed'];
  statusOptions.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s.replace('_', ' ');
    if ((editingStatus || task.status || 'backlog') === s) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.addEventListener('change', (e) => editingStatus = e.target.value);

  // Priority select
  const prioritySelect = document.createElement('select');
  const priorityOptions = ['low', 'medium', 'high', 'critical'];
  priorityOptions.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
    if ((editingPriority || task.priority || 'medium') === p) opt.selected = true;
    prioritySelect.appendChild(opt);
  });
  prioritySelect.addEventListener('change', (e) => editingPriority = e.target.value);

  // Owner select
  const ownerSelect = document.createElement('select');
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '— Assign to —';
  ownerSelect.appendChild(emptyOpt);
  const agents = window.availableAgents || [];
  agents.forEach(agent => {
    const opt = document.createElement('option');
    opt.value = agent;
    opt.textContent = agent;
    if ((editingOwner || task.owner || '') === agent) opt.selected = true;
    ownerSelect.appendChild(opt);
  });
  ownerSelect.addEventListener('change', (e) => editingOwner = e.target.value);

  // Start date input
  const startDateInput = document.createElement('input');
  startDateInput.type = 'date';
  startDateInput.value = editingStartDate || task.start_date || '';
  startDateInput.addEventListener('input', (e) => editingStartDate = e.target.value);

  // Due date input
  const dueDateInput = document.createElement('input');
  dueDateInput.type = 'date';
  dueDateInput.value = editingDueDate || task.due_date || '';
  dueDateInput.addEventListener('input', (e) => editingDueDate = e.target.value);

  // Append fields to grid
  grid.appendChild(textInput);
  grid.appendChild(categoryInput);
  grid.appendChild(statusSelect);
  grid.appendChild(prioritySelect);
  grid.appendChild(ownerSelect);
  grid.appendChild(startDateInput);
  grid.appendChild(dueDateInput);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const saveBtn = createActionButton('Save', 'save-btn', () => saveEdit(task.id));
  const cancelBtn = createActionButton('Cancel', 'cancel-btn', cancelEdit);
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);

  wrapper.appendChild(grid);
  wrapper.appendChild(actions);

  // Focus text input after render
  requestAnimationFrame(() => {
    textInput.focus();
    textInput.setSelectionRange(textInput.value.length, textInput.value.length);
  });

  return wrapper;
}

/**
 * Show undo snackbar.
 */
function showUndoSnackbar(message, undoCallback) {
  const snackbar = document.getElementById('snackbar');
  const msgEl = document.getElementById('snackbarMessage');
  const undoBtn = document.getElementById('snackbarUndo');
  if (!snackbar || !msgEl || !undoBtn) return;
  msgEl.textContent = message;
  undoBtn.onclick = () => {
    undoCallback();
    snackbar.classList.remove('visible');
    if (window.undoSnackbarTimeout) clearTimeout(window.undoSnackbarTimeout);
    if (undoStack.length > 0) undoStack.shift();
  };
  snackbar.classList.add('visible');
  if (window.undoSnackbarTimeout) clearTimeout(window.undoSnackbarTimeout);
  window.undoSnackbarTimeout = setTimeout(() => {
    snackbar.classList.remove('visible');
    if (undoStack.length > 0) undoStack.shift();
    window.undoSnackbarTimeout = null;
  }, 6000);
}

/**
 * Show owner assignment menu.
 */
function showOwnerMenu(taskId, anchorEl) {
  // Create dropdown if not exists
  let dropdown = document.querySelector('.owner-dropdown');
  if (dropdown) {
    dropdown.remove();
  }
  dropdown = document.createElement('div');
  dropdown.className = 'owner-dropdown';
  // Position near anchorEl
  const rect = anchorEl.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + window.scrollY + 4}px`;
  dropdown.style.left = `${rect.left + window.scrollX}px`;

  // Populate with agents
  const agents = window.availableAgents || [];
  if (agents.length === 0) {
    const msg = document.createElement('button');
    msg.textContent = 'No agents';
    msg.disabled = true;
    dropdown.appendChild(msg);
  } else {
    agents.forEach(agent => {
      const btn = document.createElement('button');
      btn.textContent = agent;
      btn.type = 'button';
      btn.onclick = (e) => {
        e.stopPropagation();
        updateTask(taskId, { owner: agent });
        dropdown.remove();
      };
      dropdown.appendChild(btn);
    });
  }

  document.body.appendChild(dropdown);

  // Close on outside click
  const closeHandler = (e) => {
    if (!dropdown.contains(e.target) && e.target !== anchorEl) {
      dropdown.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 0);
}

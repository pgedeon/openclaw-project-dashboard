/**
 * Loading Skeleton Components for OpenClaw Dashboard
 * 
 * Provides animated skeleton loaders for:
 * - Task list items
 * - Stats cards
 * - Input fields
 * - Buttons
 * - Timeline cards
 */

class SkeletonLoader {
  constructor() {
    this.skeletonCount = 0;
    this.cssInjected = false;
  }

  /**
   * Ensure CSS animations are injected
   */
  ensureCSS() {
    if (this.cssInjected) return;

    const style = document.createElement('style');
    style.id = 'skeleton-css';
    style.textContent = `
      @keyframes skeleton-loading {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }

      .skeleton {
        background: linear-gradient(
          90deg,
          var(--skeleton-base, #f0f0f0) 25%,
          var(--skeleton-highlight, #e0e0e0) 50%,
          var(--skeleton-base, #f0f0f0) 75%
        );
        background-size: 200% 100%;
        animation: skeleton-loading 1.5s ease-in-out infinite;
        border-radius: inherit;
      }

      [data-theme="dark"] .skeleton {
        --skeleton-base: #2a2a2a;
        --skeleton-highlight: #3a3a3a;
      }

      .skeleton-text {
        height: 1em;
        margin-bottom: 0.5em;
        border-radius: 4px;
      }

      .skeleton-text.short {
        width: 60%;
      }

      .skeleton-text.medium {
        width: 80%;
      }

      .skeleton-button {
        height: 36px;
        width: 100px;
        border-radius: 8px;
      }

      .skeleton-input {
        height: 42px;
        border-radius: 10px;
      }

      .skeleton-card {
        border-radius: 16px;
        padding: 20px;
        box-shadow: var(--shadow-soft, 0 6px 18px rgba(27,30,49,0.08));
      }

      .skeleton-task-item {
        height: 100px;
        border-radius: 16px;
        border: 1px solid var(--border, rgba(36,37,49,0.12));
        background: var(--surface, white);
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 14px;
        padding: 18px;
      }

      .skeleton-task-main {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .skeleton-timeline-card {
        height: 180px;
        border-radius: 16px;
        border: 1px solid var(--border, rgba(36,37,49,0.12));
        background: var(--surface, white);
        padding: 24px;
        margin-bottom: 16px;
      }

      .skeleton-stat-card {
        height: 120px;
        border-radius: 16px;
        padding: 20px;
        box-shadow: var(--shadow-soft, 0 6px 18px rgba(27,30,49,0.08));
      }
    `;

    document.head.appendChild(style);
    this.cssInjected = true;
  }

  /**
   * Create a skeleton task item
   * @returns {HTMLElement} Skeleton element
   */
  createTaskSkeleton() {
    this.ensureCSS();

    const item = document.createElement('div');
    item.className = 'skeleton skeleton-task-item';
    item.innerHTML = `
      <div class="skeleton-task-main">
        <div class="skeleton skeleton-text medium"></div>
        <div class="skeleton skeleton-text short"></div>
        <div class="skeleton skeleton-text" style="width: 40%;"></div>
      </div>
      <div style="display: flex; gap: 8px; align-self: start;">
        <div class="skeleton skeleton-button" style="width: 80px;"></div>
        <div class="skeleton skeleton-button" style="width: 80px;"></div>
      </div>
    `;
    this.skeletonCount++;
    return item;
  }

  /**
   * Create multiple task skeletons
   * @param {number} count - Number of skeletons to create
   * @returns {DocumentFragment} Fragment with skeletons
   */
  createTaskSkeletons(count = 5) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      fragment.appendChild(this.createTaskSkeleton());
    }
    return fragment;
  }

  /**
   * Create a skeleton stats card
   * @returns {HTMLElement} Skeleton card
   */
  createStatCardSkeleton() {
    this.ensureCSS();

    const card = document.createElement('div');
    card.className = 'skeleton skeleton-stat-card';
    card.innerHTML = `
      <div class="skeleton skeleton-text" style="height: 2rem; width: 40%; margin-bottom: 1rem;"></div>
      <div class="skeleton skeleton-text" style="height: 1.5rem; width: 60%;"></div>
    `;
    return card;
  }

  /**
   * Create skeleton stats row
   * @param {number} count - Number of stat cards
   * @returns {DocumentFragment} Fragment with stat card skeletons
   */
  createStatsSkeletons(count = 3) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      fragment.appendChild(this.createStatCardSkeleton());
    }
    return fragment;
  }

  /**
   * Create skeleton input field
   * @returns {HTMLElement} Skeleton input
   */
  createInputSkeleton() {
    this.ensureCSS();

    const input = document.createElement('div');
    input.className = 'skeleton skeleton-input';
    return input;
  }

  /**
   * Create skeleton button
   * @param {string} width - Optional width (default 100px)
   * @returns {HTMLElement} Skeleton button
   */
  createButtonSkeleton(width = '100px') {
    this.ensureCSS();

    const button = document.createElement('div');
    button.className = 'skeleton skeleton-button';
    button.style.width = width;
    return button;
  }

  /**
   * Create skeleton timeline card
   * @returns {HTMLElement} Skeleton timeline card
   */
  createTimelineCardSkeleton() {
    this.ensureCSS();

    const card = document.createElement('div');
    card.className = 'skeleton skeleton-timeline-card';
    card.innerHTML = `
      <div class="skeleton skeleton-text" style="height: 1.25rem; width: 30%; margin-bottom: 1rem;"></div>
      <div class="skeleton skeleton-text" style="height: 1rem; width: 90%; margin-bottom: 0.5rem;"></div>
      <div class="skeleton skeleton-text" style="height: 1rem; width: 85%; margin-bottom: 0.5rem;"></div>
      <div class="skeleton skeleton-text" style="height: 1rem; width: 70%;"></div>
      <div style="margin-top: 1rem; display: flex; gap: 8px;">
        <div class="skeleton skeleton-button" style="width: 60px;"></div>
        <div class="skeleton skeleton-button" style="width: 60px;"></div>
      </div>
    `;
    return card;
  }

  /**
   * Create multiple timeline card skeletons
   * @param {number} count - Number of skeletons
   * @returns {DocumentFragment} Fragment with timeline skeletons
   */
  createTimelineSkeletons(count = 5) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      fragment.appendChild(this.createTimelineCardSkeleton());
    }
    return fragment;
  }

  /**
   * Wrap a component with skeleton loading state
   * @param {HTMLElement} container - Container element
   * @param {Function} loadContent - Async function that loads actual content
   * @param {Object} options - Options (skeletons to show while loading)
   */
  async withSkeleton(container, loadContent, options = {}) {
    const {
      taskSkeletonCount = 5,
      statSkeletonCount = 3,
      timelineSkeletonCount = 5
    } = options;

    // Show skeletons
    container.innerHTML = '';
    
    if (container.classList.contains('task-list') || container.id === 'taskList') {
      container.appendChild(this.createTaskSkeletons(taskSkeletonCount));
    } else if (container.classList.contains('stats')) {
      container.appendChild(this.createStatsSkeletons(statSkeletonCount));
    } else if (container.classList.contains('timeline-view')) {
      container.appendChild(this.createTimelineSkeletons(timelineSkeletonCount));
    }

    // Load actual content
    try {
      await loadContent();
    } catch (error) {
      console.error('[SkeletonLoader] Content loading failed:', error);
      container.innerHTML = `
        <div class="empty-state">
          <p>Failed to load content. Please try again.</p>
        </div>
      `;
    }
  }

  /**
   * Show loading state on a button
   * @param {HTMLElement} button - Button element
   * @param {string} originalText - Original button text to restore later
   */
  setButtonLoading(button, originalText) {
    if (!button) return;
    
    button.dataset.originalText = button.textContent;
    button.textContent = 'Loading...';
    button.disabled = true;
    button.classList.add('skeleton');
    button.style.width = button.offsetWidth + 'px';
  }

  /**
   * Clear button loading state
   * @param {HTMLElement} button - Button element
   */
  clearButtonLoading(button) {
    if (!button) return;
    
    button.textContent = button.dataset.originalText || '';
    button.disabled = false;
    button.classList.remove('skeleton');
    button.style.width = '';
    delete button.dataset.originalText;
  }

  /**
   * Check if skeleton CSS is loaded
   * @returns {boolean}
   */
  isCSSLoaded() {
    return this.cssInjected;
  }
}

export const skeletonLoader = new SkeletonLoader();
export { SkeletonLoader };
export default SkeletonLoader;

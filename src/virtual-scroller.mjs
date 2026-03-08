/**
 * Virtual Scroller for OpenClaw Dashboard
 * 
 * Provides smooth virtual scrolling for large task lists:
 * - Only renders visible items + buffer
 * - Recycles DOM elements to minimize creation/destruction
 * - Maintains scroll position accurately
 * - Handles dynamic item heights (approximate)
 * 
 * Usage:
 *   const virtualScroller = new VirtualScroller({
 *     container: document.getElementById('taskList'),
 *     itemHeight: 100, // Estimated average height
 *     buffer: 5, // Number of items to render outside viewport
 *     renderItem: (task, index) => DOMElement
 *   });
 *   virtualScroller.setItems(tasks);
 */

class VirtualScroller {
  constructor(options) {
    this.container = options.container;
    this.itemHeight = options.itemHeight || 100;
    this.buffer = options.buffer || 5;
    this.renderItem = options.renderItem || (() => document.createElement('div'));
    this.items = [];
    this.visibleItems = new Map(); // Map of index -> DOM element
    this.spacerTop = null;
    this.spacerBottom = null;
    this.scrollTop = 0;
    this.containerHeight = 0;
    this.isScrolling = false;
    this.scrollTimeout = null;
    this.visibleStart = 0;
    this.visibleEnd = 0;
    this.scrollAnimationFrame = null;
    this.destroyed = false;

    this.init();
  }

  /**
   * Initialize virtual scroller
   */
  init() {
    if (!this.container) {
      console.error('[VirtualScroller] Container not found');
      return;
    }

    // Add spacers for total height
    this.spacerTop = document.createElement('div');
    this.spacerTop.style.cssText = 'width: 1px; flex-shrink: 0;';
    this.spacerBottom = document.createElement('div');
    this.spacerBottom.style.cssText = 'width: 1px; flex-shrink: 0;';

    this.container.appendChild(this.spacerTop);
    this.container.appendChild(this.spacerBottom);

    // Set container styles
    this.container.style.display = 'flex';
    this.container.style.flexDirection = 'column';
    this.container.style.position = 'relative';
    this.container.style.overflowY = 'auto';
    this.container.style.overflowX = 'hidden';
    this.container.style.willChange = 'transform';

    // Bind scroll handler
    this.container.addEventListener('scroll', this.onScroll.bind(this), { passive: true });

    // Set initial dimensions
    this.updateContainerHeight();
    window.addEventListener('resize', () => {
      this.updateContainerHeight();
      this.render();
    });
  }

  /**
   * Update container height measurement
   */
  updateContainerHeight() {
    this.containerHeight = this.container.clientHeight;
    this.updateSpacers();
  }

  /**
   * Handle scroll events
   */
  onScroll() {
    if (this.destroyed) return;

    this.scrollTop = this.container.scrollTop;
    this.isScrolling = true;

    // Cancel any pending animation frame
    if (this.scrollAnimationFrame) {
      cancelAnimationFrame(this.scrollAnimationFrame);
    }

    // Schedule render on next animation frame
    this.scrollAnimationFrame = requestAnimationFrame(() => {
      this.render();
      this.isScrolling = false;
    });

    // Clear previous timeout
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }
  }

  /**
   * Update spacer heights to match total content height
   */
  updateSpacers() {
    const totalHeight = this.items.length * this.itemHeight;
    this.spacerTop.style.height = `${this.scrollTop}px`;
    this.spacerBottom.style.height = `${Math.max(0, totalHeight - this.scrollTop - this.containerHeight)}px`;
  }

  /**
   * Set items to render
   * @param {Array} newItems - Array of data items
   */
  setItems(newItems) {
    this.items = newItems || [];
    
    // Reset visible items map
    this.visibleItems.forEach((el, index) => {
      if (el && el.parentNode) {
        el.remove();
      }
    });
    this.visibleItems.clear();

    // Update total height
    this.updateSpacers();

    // Initial render
    this.render();
  }

  /**
   * Update item heights based on actual measurements (optional optimization)
   * @param {Array} heights - Array of measured heights for each index
   */
  updateHeights(heights) {
    if (!heights || heights.length === 0) return;

    // Recalculate average if needed
    let totalMeasured = 0;
    let count = 0;
    for (let i = 0; i < Math.min(heights.length, this.items.length); i++) {
      if (heights[i] && heights[i] > 0) {
        totalMeasured += heights[i];
        count++;
      }
    }

    if (count > 0) {
      this.itemHeight = Math.max(50, Math.round(totalMeasured / count));
    }
  }

  /**
   * Render visible items
   */
  render() {
    if (this.destroyed || this.items.length === 0) {
      return;
    }

    const startIndex = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - this.buffer);
    const endIndex = Math.min(
      this.items.length - 1,
      Math.floor((this.scrollTop + this.containerHeight) / this.itemHeight) + this.buffer
    );

    // Don't re-render if visible range hasn't changed
    if (startIndex === this.visibleStart && endIndex === this.visibleEnd) {
      return;
    }

    this.visibleStart = startIndex;
    this.visibleEnd = endIndex;

    // Remove items that are no longer visible
    const toRemove = [];
    this.visibleItems.forEach((el, index) => {
      if (index < startIndex || index > endIndex) {
        toRemove.push(index);
      }
    });
    toRemove.forEach(index => {
      const el = this.visibleItems.get(index);
      if (el && el.parentNode) {
        el.remove();
      }
      this.visibleItems.delete(index);
    });

    // Insert new visible items (before spacerBottom)
    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.visibleItems.has(i)) {
        const itemData = this.items[i];
        if (itemData) {
          const element = this.renderItem(itemData, i);
          if (element) {
            element.style.position = 'absolute';
            element.style.top = `${i * this.itemHeight}px`;
            element.style.width = '100%';
            element.style.boxSizing = 'border-box';
            
            this.container.insertBefore(element, this.spacerBottom);
            this.visibleItems.set(i, element);
          }
        }
      }
    }

    // Update spacer positions
    this.spacerTop.style.height = `${startIndex * this.itemHeight}px`;
    const bottomOffset = this.items.length - endIndex - 1;
    this.spacerBottom.style.height = `${Math.max(0, bottomOffset * this.itemHeight)}px`;
  }

  /**
   * Scroll to a specific index
   * @param {number} index - Index to scroll to
   * @param {boolean} smooth - Use smooth scrolling
   */
  scrollToIndex(index, smooth = true) {
    if (index < 0 || index >= this.items.length) return;
    
    const targetScroll = index * this.itemHeight;
    
    if (smooth) {
      this.container.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      });
    } else {
      this.container.scrollTop = targetScroll;
    }
  }

  /**
   * Scroll to top
   */
  scrollToTop() {
    this.container.scrollTop = 0;
  }

  /**
   * Get current scroll position
   * @returns {number} Current scroll position
   */
  getScrollTop() {
    return this.scrollTop;
  }

  /**
   * Get number of items
   * @returns {number} Total item count
   */
  getItemCount() {
    return this.items.length;
  }

  /**
   * Check if scroller is active
   * @returns {boolean}
   */
  isActive() {
    return this.items.length > 100; // Only use virtual scrolling for >100 items
  }

  /**
   * Destroy virtual scroller and clean up
   */
  destroy() {
    this.destroyed = true;
    
    if (this.scrollAnimationFrame) {
      cancelAnimationFrame(this.scrollAnimationFrame);
    }
    
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }

    this.container?.removeEventListener('scroll', this.onScroll);
    window?.removeEventListener('resize', this.updateContainerHeight);

    this.visibleItems.forEach((el) => {
      if (el && el.parentNode) {
        el.remove();
      }
    });
    this.visibleItems.clear();

    if (this.spacerTop && this.spacerTop.parentNode) {
      this.spacerTop.remove();
    }
    if (this.spacerBottom && this.spacerBottom.parentNode) {
      this.spacerBottom.remove();
    }

    // Reset container styles
    if (this.container) {
      this.container.style = '';
    }
  }
}

export { VirtualScroller };
export default VirtualScroller;

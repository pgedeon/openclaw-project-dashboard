/**
 * Performance Monitor for OpenClaw Dashboard
 * 
 * Tracks and reports performance metrics:
 * - Render times for views
 * - Filter/sort operation times
 * - DOM update times
 * - Memory usage (when available)
 */

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      renderTimes: [],
      filterSortTimes: [],
      viewSwitchTimes: [],
      domOperationTimes: []
    };
    this.maxSamples = 50; // Keep last 50 samples
    this.enabled = true;
    this.verbose = false; // Set to true for console logging
  }

  /**
   * Start timing an operation
   * @param {string} operation - Operation name
   * @returns {function} End timer function that records the duration
   */
  time(operation) {
    if (!this.enabled) return () => {};

    const start = performance.now();
    return (additionalData = {}) => {
      const end = performance.now();
      const duration = end - start;

      this.record(operation, duration, additionalData);

      if (this.verbose) {
        console.log(`[Performance] ${operation}: ${duration.toFixed(2)}ms`, additionalData);
      }

      return duration;
    };
  }

  /**
   * Record a metric
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in milliseconds
   * @param {Object} data - Additional data
   */
  record(operation, duration, data = {}) {
    const metric = {
      timestamp: Date.now(),
      operation,
      duration,
      ...data
    };

    // Store in appropriate array
    if (operation.includes('render')) {
      this.metrics.renderTimes.push(metric);
      if (this.metrics.renderTimes.length > this.maxSamples) {
        this.metrics.renderTimes.shift();
      }
    } else if (operation.includes('filter') || operation.includes('sort')) {
      this.metrics.filterSortTimes.push(metric);
      if (this.metrics.filterSortTimes.length > this.maxSamples) {
        this.metrics.filterSortTimes.shift();
      }
    } else if (operation.includes('switch') || operation.includes('view')) {
      this.metrics.viewSwitchTimes.push(metric);
      if (this.metrics.viewSwitchTimes.length > this.maxSamples) {
        this.metrics.viewSwitchTimes.shift();
      }
    } else {
      this.metrics.domOperationTimes.push(metric);
      if (this.metrics.domOperationTimes.length > this.maxSamples) {
        this.metrics.domOperationTimes.shift();
      }
    }
  }

  /**
   * Get statistics for an operation type
   * @param {string} operation - Operation name or category
   * @returns {Object} Statistics object
   */
  getStats(operationCategory) {
    let metrics;
    if (operationCategory === 'render') {
      metrics = this.metrics.renderTimes;
    } else if (operationCategory === 'filterSort') {
      metrics = this.metrics.filterSortTimes;
    } else if (operationCategory === 'viewSwitch') {
      metrics = this.metrics.viewSwitchTimes;
    } else {
      metrics = this.metrics.domOperationTimes;
    }

    if (metrics.length === 0) {
      return { count: 0, avg: 0, min: 0, max: 0, median: 0 };
    }

    const durations = metrics.map(m => m.duration);
    durations.sort((a, b) => a - b);

    const sum = durations.reduce((acc, val) => acc + val, 0);
    const avg = sum / durations.length;
    const min = durations[0];
    const max = durations[durations.length - 1];
    const median = durations[Math.floor(durations.length / 2)];

    return {
      count: metrics.length,
      avg: Number(avg.toFixed(2)),
      min: Number(min.toFixed(2)),
      max: Number(max.toFixed(2)),
      median: Number(median.toFixed(2))
    };
  }

  /**
   * Get a comprehensive performance report
   * @returns {Object} Performance report
   */
  getReport() {
    return {
      timestamp: new Date().toISOString(),
      metrics: {
        render: this.getStats('render'),
        filterSort: this.getStats('filterSort'),
        viewSwitch: this.getStats('viewSwitch'),
        domOperations: this.getStats('domOperation')
      },
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Generate performance recommendations based on metrics
   * @returns {Array} Array of recommendation strings
   */
  generateRecommendations() {
    const recommendations = [];
    const renderStats = this.getStats('render');
    const filterSortStats = this.getStats('filterSort');
    const viewSwitchStats = this.getStats('viewSwitch');

    // Check render times
    if (renderStats.count > 0 && renderStats.avg > 100) {
      recommendations.push(`Render times are averaging ${renderStats.avg}ms (target: <100ms). Consider implementing virtual scrolling for larger datasets.`);
    }

    // Check filter/sort times
    if (filterSortStats.count > 0 && filterSortStats.avg > 50) {
      recommendations.push(`Filter/sort operations average ${filterSortStats.avg}ms. Consider using Web Workers for off-main-thread processing.`);
    }

    // Check view switch times
    if (viewSwitchStats.count > 0 && viewSwitchStats.avg > 100) {
      recommendations.push(`View switches average ${viewSwitchStats.avg}ms. Implement skeleton loaders and lazy loading for smoother transitions.`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Performance looks good! All metrics are within acceptable ranges.');
    }

    return recommendations;
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics = {
      renderTimes: [],
      filterSortTimes: [],
      viewSwitchTimes: [],
      domOperationTimes: []
    };
  }

  /**
   * Enable or disable monitoring
   * @param {boolean} enabled - Whether to enable monitoring
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Export metrics as JSON
   * @returns {string} JSON string of all metrics
   */
  exportMetrics() {
    return JSON.stringify({
      ...this.metrics,
      report: this.getReport()
    }, null, 2);
  }

  /**
   * Get metrics summary for console display
   * @returns {string} Formatted summary string
   */
  getSummary() {
    const report = this.getReport();
    let summary = `\n=== Performance Summary ===\n`;
    summary += `Time: ${new Date(report.timestamp).toLocaleString()}\n\n`;

    for (const [category, stats] of Object.entries(report.metrics)) {
      if (stats.count > 0) {
        summary += `${category.toUpperCase()}:\n`;
        summary += `  Count: ${stats.count}\n`;
        summary += `  Avg: ${stats.avg}ms\n`;
        summary += `  Min: ${stats.min}ms\n`;
        summary += `  Max: ${stats.max}ms\n`;
        summary += `  Median: ${stats.median}ms\n\n`;
      }
    }

    summary += `Recommendations:\n`;
    report.recommendations.forEach((rec, i) => {
      summary += `  ${i + 1}. ${rec}\n`;
    });

    return summary;
  }
}

// Create singleton
export const performanceMonitor = new PerformanceMonitor();

// Expose on window for debugging
if (typeof window !== 'undefined') {
  window.performanceMonitor = performanceMonitor;
}

export default PerformanceMonitor;

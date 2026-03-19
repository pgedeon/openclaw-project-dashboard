export function createViewRegistry(entries = {}) {
  const registry = new Map(Object.entries(entries));

  return {
    get(view) {
      return registry.get(view) || null;
    },

    has(view) {
      return registry.has(view);
    },

    list() {
      return Array.from(registry.keys());
    },

    async render(view, state) {
      const entry = registry.get(view);
      if (!entry || typeof entry.render !== 'function') {
        return false;
      }

      await entry.render(state);
      return true;
    }
  };
}

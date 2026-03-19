/**
 * Internationalization (i18n) Module
 * Provides translation functions and language management for the dashboard.
 *
 * @module i18n
 */

const DEFAULT_LOCALE = 'en';
const LOCALES_PATH = './src/locales/';

let currentLocale = DEFAULT_LOCALE;
let translations = {};
let listeners = [];

/**
 * Initialize i18n system.
 * Loads the default locale and sets up language detection.
 * @returns {Promise<void>}
 */
export async function initI18n() {
  const browserLang = navigator.language || navigator.userLanguage || DEFAULT_LOCALE;
  const baseLang = browserLang.split('-')[0]; // e.g., 'en-US' -> 'en'
  const savedLocale = localStorage.getItem('dashboard_locale');

  const localeToLoad = savedLocale || baseLang || DEFAULT_LOCALE;
  await loadLocale(localeToLoad);
}

/**
 * Load a locale's translation file.
 * @param {string} locale - Locale code (e.g., 'en', 'es', 'fr')
 * @returns {Promise<void>}
 */
export async function loadLocale(locale) {
  try {
    const response = await fetch(`${LOCALES_PATH}${locale}.json`);
    if (!response.ok) {
      throw new Error(`Locale ${locale} not found`);
    }
    const data = await response.json();
    // Support both formats: { "en": { ... } } and flat { ... }
    translations = data[locale] || data;
    currentLocale = locale;
    localStorage.setItem('dashboard_locale', locale);
    notifyListeners();
  } catch (error) {
    console.warn(`Failed to load locale '${locale}':`, error);
    if (locale !== DEFAULT_LOCALE) {
      await loadLocale(DEFAULT_LOCALE);
    }
  }
}

/**
 * Translate a key using dot notation.
 * Supports parameter substitution with {param} syntax.
 * @param {string} key - Translation key (e.g., 'task.addBtn')
 * @param {Object} params - Optional parameters for interpolation
 * @returns {string} Translated string or key if not found
 */
export function t(key, params = {}) {
  const keys = key.split('.');
  let value = translations;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      return key; // fallback to key
    }
  }

  if (typeof value !== 'string') {
    return key;
  }

  // Interpolate parameters
  if (Object.keys(params).length > 0) {
    return value.replace(/\{(\w+)\}/g, (match, param) => {
      return params[param] !== undefined ? params[param] : match;
    });
  }

  return value;
}

/**
 * Get current locale.
 * @returns {string}
 */
export function getCurrentLocale() {
  return currentLocale;
}

/**
 * Get list of available locales.
 * @returns {string[]}
 */
export function getAvailableLocales() {
  // In a real implementation, you might fetch this from the server or a manifest
  return ['en']; // extend as more locales are added
}

/**
 * Subscribe to locale changes.
 * @param {Function} callback - Called when locale changes
 * @returns {Function} Unsubscribe function
 */
export function subscribe(callback) {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter(l => l !== callback);
  };
}

/**
 * Notify all subscribers of locale change.
 */
function notifyListeners() {
  listeners.forEach(cb => cb(currentLocale));
}

/**
 * Change the current locale.
 * @param {string} locale - Locale code to switch to
 * @returns {Promise<void>}
 */
export async function setLocale(locale) {
  if (locale !== currentLocale) {
    await loadLocale(locale);
  }
}

// Initialize on module load (will be called from main script)
// initI18n();

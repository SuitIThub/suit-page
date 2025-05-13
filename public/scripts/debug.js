// Debug flag - can be set via URL parameter
export const isDebugMode = new URLSearchParams(window.location.search).has('debug');

// Debug logging functions
export const debug = {
  log: (...args) => {
    if (isDebugMode) {
      console.log(...args);
    }
  },
  warn: (...args) => {
    if (isDebugMode) {
      console.warn(...args);
    }
  },
  error: (...args) => {
    // Always log errors, even in non-debug mode
    console.error(...args);
  }
}; 
// Cooking helpers state (R10–R12): per-recipe servings and check-offs for
// this browser session, and the Screen Wake Lock.

const KEY = (id) => `recipes:cook:${id}`;

/**
 * @typedef {object} CookState
 * @property {number} factor          scale factor relative to the recipe as written
 * @property {number[]} ingredients   ticked ingredient indexes
 * @property {string[]} steps         ticked steps as "section.step"
 */

/** @returns {CookState} */
export const freshCookState = () => ({ factor: 1, ingredients: [], steps: [] });

/**
 * Load a recipe's cooking state for this session (R11: session only).
 * Storage can be unavailable (private mode, blocked): falls back to fresh.
 * @param {string} id
 * @returns {CookState}
 */
export function loadCookState(id) {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY(id)) ?? 'null');
    if (!raw || typeof raw !== 'object') return freshCookState();
    return {
      factor: Number.isFinite(raw.factor) && raw.factor > 0 && raw.factor <= 100 ? raw.factor : 1,
      ingredients: Array.isArray(raw.ingredients) ? raw.ingredients.filter(Number.isInteger) : [],
      steps: Array.isArray(raw.steps) ? raw.steps.filter((s) => typeof s === 'string') : [],
    };
  } catch {
    return freshCookState();
  }
}

/** @param {string} id @param {CookState} state */
export function saveCookState(id, state) {
  try {
    const fresh = state.factor === 1 && !state.ingredients.length && !state.steps.length;
    if (fresh) sessionStorage.removeItem(KEY(id));
    else sessionStorage.setItem(KEY(id), JSON.stringify(state));
  } catch {
    /* storage unavailable: state lasts until the page is left */
  }
}

/**
 * Screen Wake Lock (R12). Null where unsupported — note browsers only offer
 * it on secure origins (HTTPS or localhost), so plain-HTTP LAN hosting won't
 * show the toggle.
 * The lock is dropped by the browser when the tab is hidden; it is
 * re-acquired when the tab becomes visible again while still wanted.
 */
export function createWakeLock() {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return null;
  let sentinel = null;
  let wanted = false;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(wanted));

  async function acquire() {
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
    } catch {
      // Refused (battery saver, not visible…): show the toggle as off.
      wanted = false;
    }
    notify();
  }

  document.addEventListener('visibilitychange', () => {
    if (wanted && !sentinel && document.visibilityState === 'visible') acquire();
  });

  return {
    get on() {
      return wanted;
    },
    /** @param {boolean} on */
    async set(on) {
      if (on === wanted) return;
      wanted = on;
      if (on) {
        await acquire();
      } else {
        const s = sentinel;
        sentinel = null;
        notify();
        await s?.release().catch(() => {});
      }
    },
    /** @param {(on: boolean) => void} fn @returns {() => void} unsubscribe */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

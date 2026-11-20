// Entry point: hash router and view switching.
// Routes:  #/                 → all recipes
//          #/recipe/<id>      → one recipe (id = path in the recipes folder, no extension)

import { h, icon } from './dom.js';
import { loadIndex, loadRecipe, LoadError } from './data.js';
import { renderHome } from './views/home.js';
import { renderRecipe } from './views/recipe.js';
import { messageView } from './views/common.js';

const APP_NAME = 'Recipes';
const viewEl = /** @type {HTMLElement} */ (document.getElementById('view'));
const backEl = /** @type {HTMLAnchorElement} */ (document.getElementById('back'));

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

let navToken = 0;
let firstRender = true;
let homeScrollY = 0;
/** First card visible when leaving the list, and its distance from the viewport top. */
let homeAnchor = null;
let currentRoute = '';
let cameFromHome = false;
/** The built list view, reused when returning so "back" is instant and keeps its scroll position. */
let homeCache = { index: null, node: null };

/** @returns {{ name: 'home' } | { name: 'recipe', id: string } | { name: 'unknown' }} */
function parseRoute(hash) {
  const path = hash.replace(/^#\/?/, '');
  if (path === '') return { name: 'home' };
  const [first, ...rest] = path.split('/');
  if (first === 'recipe' && rest.length) {
    try {
      return { name: 'recipe', id: rest.map(decodeURIComponent).join('/') };
    } catch {
      return { name: 'unknown' };
    }
  }
  return { name: 'unknown' };
}

/** Swap the view and move focus to its heading (for screen readers). */
function show(node, { title, scrollY = 0, focus = true } = {}) {
  viewEl.replaceChildren(node);
  document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  window.scrollTo(0, scrollY);
  if (focus && !firstRender) node.querySelector('h1')?.focus({ preventScroll: true });
  firstRender = false;
}

function retryButton() {
  return h('button', { type: 'button', class: 'button', onclick: () => route() }, 'Try again');
}

/** @param {unknown} err */
function indexErrorView(err) {
  if (err instanceof LoadError && err.kind === 'missing') {
    return messageView({
      tone: 'error',
      title: 'No recipe index found',
      body: [
        "The app couldn't find recipes/index.json. Build it from your recipes folder and reload:",
        h('pre', null, h('code', null, 'node tools/build-index.mjs <recipes-folder>')),
      ],
      action: retryButton(),
    });
  }
  return messageView({
    tone: 'error',
    title: "Couldn't load recipes",
    body: [err instanceof Error ? err.message : String(err)],
    action: retryButton(),
  });
}

function notFoundView(what) {
  return messageView({
    title: `${what} not found`,
    body: ['It may have been renamed or removed.'],
    action: h('a', { class: 'button', href: '#/' }, 'See all recipes'),
  });
}

async function route() {
  const token = ++navToken;
  const stale = () => token !== navToken;
  const r = parseRoute(location.hash);

  if (currentRoute === 'home' && r.name !== 'home') rememberHomePosition();
  const returningHome = r.name === 'home' && currentRoute !== 'home' && currentRoute !== '';
  cameFromHome = currentRoute === 'home' && r.name === 'recipe';
  currentRoute = r.name;
  backEl.hidden = r.name === 'home';
  document.documentElement.dataset.route = r.name;

  let index;
  try {
    const pending = loadIndex();
    // Only show a loading message if the index is slow to arrive.
    const timer = setTimeout(() => {
      if (!stale()) show(h('main', { id: 'main', class: 'loading', role: 'status' }, 'Loading recipes…'), { focus: false });
    }, 150);
    index = await pending.finally(() => clearTimeout(timer));
  } catch (err) {
    if (!stale()) show(indexErrorView(err), { title: 'Error' });
    return;
  }
  if (stale()) return;

  if (r.name === 'home') {
    if (homeCache.index !== index) homeCache = { index, node: renderHome(index) };
    show(homeCache.node, { scrollY: returningHome ? homeScrollY : 0 });
    if (returningHome) restoreHomeAnchor();
    return;
  }
  if (r.name === 'unknown') {
    show(notFoundView('Page'), { title: 'Not found' });
    return;
  }

  const entry = index.recipes.find((e) => e.id === r.id);
  if (!entry) {
    show(notFoundView('Recipe'), { title: 'Not found' });
    return;
  }
  show(renderRecipe(entry, null), { title: entry.name });
  try {
    const recipe = await loadRecipe(entry);
    if (stale()) return;
    viewEl.replaceChildren(renderRecipe(entry, recipe));
  } catch (err) {
    if (stale()) return;
    viewEl.replaceChildren(renderRecipe(entry, null, { error: err instanceof Error ? err.message : String(err) }));
  }
}

function rememberHomePosition() {
  homeScrollY = window.scrollY;
  const barBottom = document.querySelector('.app-bar')?.getBoundingClientRect().bottom ?? 0;
  const card = [...viewEl.querySelectorAll('.card')].find((c) => c.getBoundingClientRect().bottom > barBottom);
  homeAnchor = card ? { el: card, top: card.getBoundingClientRect().top } : null;
}

/**
 * Off-screen cards use estimated heights (content-visibility), and they
 * switch to their real heights over the next few frames after the list is
 * reattached. Keep nudging the page until the remembered card is back where
 * it was and has stayed there for a few frames (max ~1s). Stops as soon as
 * the user scrolls themselves.
 */
function restoreHomeAnchor() {
  const anchor = homeAnchor;
  if (!anchor?.el.isConnected) return;
  const started = performance.now();
  let stableFrames = 0;
  let cancelled = false;
  const cancel = () => (cancelled = true);
  const inputs = ['wheel', 'touchstart', 'keydown', 'mousedown'];
  inputs.forEach((t) => window.addEventListener(t, cancel, { once: true, passive: true }));
  const done = () => inputs.forEach((t) => window.removeEventListener(t, cancel));

  const step = () => {
    if (cancelled || !anchor.el.isConnected || currentRoute !== 'home') return done();
    const diff = anchor.el.getBoundingClientRect().top - anchor.top;
    if (Math.abs(diff) >= 1) {
      window.scrollBy(0, diff);
      stableFrames = 0;
    } else {
      stableFrames += 1;
    }
    if (stableFrames >= 5 || performance.now() - started > 1000) return done();
    requestAnimationFrame(step);
  };
  step();
}

backEl.prepend(icon('back'));
backEl.addEventListener('click', (e) => {
  // If we came here from the list, go back in history so the browser's back
  // stack stays natural; otherwise (deep link) the link's href="#/" applies.
  if (cameFromHome) {
    e.preventDefault();
    history.back();
  }
});

window.addEventListener('hashchange', route);
route();

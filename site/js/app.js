// Entry point: hash router and view switching.
// Routes:  #/                 → all recipes; #/?q=…&meal=… → searched/filtered (R8)
//          #/recipe/<id>      → one recipe (id = path in the recipes folder, no extension)

import { h, icon } from './dom.js';
import { loadIndex, loadRecipe, LoadError } from './data.js';
import { createHome } from './views/home.js';
import { parseState, serializeState } from './search.js';
import { createWakeLock } from './cooking.js';
import { renderRecipe } from './views/recipe.js';
import { messageView } from './views/common.js';

const APP_NAME = 'Recipes';
const wakeLock = createWakeLock();
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
let home = null;

/** @returns {{ name: 'home', query: string } | { name: 'recipe', id: string } | { name: 'unknown' }} */
function parseRoute(hash) {
  const raw = hash.replace(/^#\/?/, '');
  const q = raw.indexOf('?');
  const path = q < 0 ? raw : raw.slice(0, q);
  if (path === '') return { name: 'home', query: q < 0 ? '' : raw.slice(q + 1) };
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

/**
 * Swap the view and move focus to its heading (for screen readers).
 * The home view is hidden rather than removed while another view shows, so
 * the browser keeps the measured heights of its cards and "back" lands on
 * exactly the same spot.
 */
function show(node, { title, scrollY = 0, focus = true } = {}) {
  for (const child of [...viewEl.children]) {
    if (child === node) continue;
    if (child === home?.node) child.hidden = true;
    else child.remove();
  }
  if (node.parentNode !== viewEl) viewEl.append(node);
  node.hidden = false;
  document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  window.scrollTo(0, scrollY);
  if (focus && !firstRender) node.querySelector('h1')?.focus({ preventScroll: true });
  firstRender = false;
}

/** Replace the visible (non-home) view without moving focus or scroll. */
function replaceView(node) {
  const current = [...viewEl.children].find((c) => !c.hidden && c !== home?.node);
  if (current) current.replaceWith(node);
  else viewEl.append(node);
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
  // The screen only needs to stay on while a recipe is open (R12).
  if (r.name !== 'recipe') wakeLock?.set(false);
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
    const state = parseState(r.query);
    if (home?.index !== index) {
      home = createHome(index, { onStateChange: updateHomeUrl });
      home.setState(state);
    } else if (serializeState(state) !== serializeState(home.state)) {
      home.setState(state);
    }
    show(home.node, { scrollY: returningHome ? homeScrollY : 0 });
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
    replaceView(renderRecipe(entry, recipe, { wakeLock }));
  } catch (err) {
    if (stale()) return;
    replaceView(renderRecipe(entry, null, { error: err instanceof Error ? err.message : String(err) }));
  }
}

/** Keep search and filter state in the URL without adding history entries (R8). */
function updateHomeUrl(state) {
  const query = serializeState(state);
  history.replaceState(history.state, '', `#/${query ? `?${query}` : ''}`);
}

function rememberHomePosition() {
  homeScrollY = window.scrollY;
  // Cards hidden under the sticky app bar or search toolbar don't count as visible.
  const barBottom = Math.max(
    ...[...document.querySelectorAll('.app-bar, .home-toolbar')].map((el) => el.getBoundingClientRect().bottom),
    0,
  );
  const card = [...viewEl.querySelectorAll('.card')].find((c) => c.getBoundingClientRect().bottom > barBottom);
  homeAnchor = card ? { el: card, top: card.getBoundingClientRect().top } : null;
}

/**
 * Off-screen cards use estimated heights (content-visibility) and switch to
 * their real heights when the browser gets round to measuring them, which
 * can be several frames later on a slow or busy device. Re-anchor the
 * remembered card whenever the list changes size, for up to 1.5s, and stop
 * as soon as the user scrolls or touches the page.
 */
function restoreHomeAnchor() {
  const anchor = homeAnchor;
  const list = home?.node.querySelector('.card-list');
  if (!anchor?.el.isConnected || !list) return;

  const correct = () => {
    if (!anchor.el.isConnected || currentRoute !== 'home') return finish();
    const diff = anchor.el.getBoundingClientRect().top - anchor.top;
    if (Math.abs(diff) >= 1) window.scrollBy(0, diff);
  };
  const inputs = ['wheel', 'touchstart', 'keydown', 'mousedown'];
  const observer = 'ResizeObserver' in window ? new ResizeObserver(correct) : null;
  const timer = setTimeout(() => finish(), 1500);
  function finish() {
    observer?.disconnect();
    clearTimeout(timer);
    inputs.forEach((t) => window.removeEventListener(t, finish));
  }
  inputs.forEach((t) => window.addEventListener(t, finish, { once: true, passive: true }));
  correct();
  observer?.observe(list);
  requestAnimationFrame(correct);
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

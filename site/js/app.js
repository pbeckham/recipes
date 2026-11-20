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
let currentRoute = '';
let cameFromHome = false;

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

  if (currentRoute === 'home' && r.name !== 'home') homeScrollY = window.scrollY;
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
    show(renderHome(index), { scrollY: returningHome ? homeScrollY : 0 });
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

// Home view: every recipe as a card (R5). Search and filters arrive in phase 3.

import { h, icon } from '../dom.js';
import { formatMinutes } from '../format.js';
import { badges, recipeHref, recipeImage, messageView } from './common.js';

/** @param {any} entry index entry */
function card(entry) {
  const time = formatMinutes(entry.totalMinutes);
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'card', href: recipeHref(entry.id) },
      recipeImage(entry.image, { className: 'card-media' }),
      h(
        'div',
        { class: 'card-body' },
        h('h2', { class: 'card-title' }, entry.name),
        time ? h('p', { class: 'card-meta' }, icon('clock'), h('span', { class: 'visually-hidden' }, 'Total time: '), time) : null,
        badges(entry),
      ),
    ),
  );
}

/**
 * @param {{ recipes: any[] }} index
 * @returns {HTMLElement}
 */
export function renderHome(index) {
  const { recipes } = index;
  if (!recipes.length) {
    return messageView({
      title: 'No recipes yet',
      body: [
        'The recipe index is empty. Add schema.org Recipe files (.json or .jsonld) to the recipes folder, then rebuild the index:',
        h('pre', null, h('code', null, 'node tools/build-index.mjs <recipes-folder>')),
      ],
    });
  }
  const list = h('ul', { class: 'card-list', role: 'list' });
  const sentinel = h('div', { class: 'list-sentinel', 'aria-hidden': 'true' });
  const main = h(
    'main',
    { id: 'main', class: 'home' },
    h(
      'div',
      { class: 'page-head' },
      h('h1', { tabindex: '-1' }, 'All recipes'),
      h('p', { class: 'page-count' }, `${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}`),
    ),
    list,
    sentinel,
  );
  renderIncrementally(recipes, list, sentinel);
  return main;
}

/** Cards rendered up front and per batch while scrolling (N6). */
export const BATCH_SIZE = 48;
/** Start rendering the next batch when this close to the end of the list. */
const LOOKAHEAD_PX = 1500;

/**
 * Render cards in batches as the user scrolls, so a 1,000+ recipe
 * collection doesn't build tens of thousands of DOM nodes up front.
 * @param {any[]} recipes
 * @param {HTMLElement} list
 * @param {HTMLElement} sentinel element after the list; nearing it loads more
 */
function renderIncrementally(recipes, list, sentinel) {
  let shown = 0;
  let observer = null;

  const nearEnd = () => sentinel.isConnected && sentinel.getBoundingClientRect().top < window.innerHeight + LOOKAHEAD_PX;
  const more = () => {
    const next = recipes.slice(shown, shown + BATCH_SIZE);
    list.append(...next.map(card));
    shown += next.length;
    if (shown >= recipes.length) {
      observer?.disconnect();
      sentinel.remove();
      return;
    }
    // A tall screen may still show the sentinel after appending: keep going.
    requestAnimationFrame(() => nearEnd() && more());
  };

  list.append(...recipes.slice(0, BATCH_SIZE).map(card));
  shown = Math.min(BATCH_SIZE, recipes.length);
  if (shown >= recipes.length) {
    sentinel.remove();
    return;
  }
  if (!('IntersectionObserver' in window)) {
    list.append(...recipes.slice(shown).map(card));
    sentinel.remove();
    return;
  }
  observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && more(), {
    rootMargin: `0px 0px ${LOOKAHEAD_PX}px 0px`,
  });
  observer.observe(sentinel);
}

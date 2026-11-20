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
  return h(
    'main',
    { id: 'main', class: 'home' },
    h(
      'div',
      { class: 'page-head' },
      h('h1', { tabindex: '-1' }, 'All recipes'),
      h('p', { class: 'page-count' }, `${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}`),
    ),
    h('ul', { class: 'card-list', role: 'list' }, recipes.map(card)),
  );
}

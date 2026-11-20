// Pieces shared by several views.

import { h, icon } from '../dom.js';
import { FACETS, FACET_LABELS } from '../taxonomy.js';
import { recipesUrl } from '../data.js';

/** "#/recipe/mains/lasagne" for an index id. */
export const recipeHref = (id) => `#/recipe/${id.split('/').map(encodeURIComponent).join('/')}`;

/**
 * Meal/Protein/Carb badges for an index entry. Facets without values are skipped.
 * @param {{ meal: string[], protein: string[], carb: string[], inferred: string[] }} entry
 * @param {{ labelled?: boolean }} [options] labelled: prefix each group with its facet name
 */
export function badges(entry, { labelled = false } = {}) {
  const items = [];
  for (const facet of FACETS) {
    const inferred = entry.inferred?.includes(facet);
    for (const value of entry[facet] ?? []) {
      items.push(
        h(
          'li',
          {
            class: `badge badge-${facet}${inferred ? ' badge-inferred' : ''}`,
            title: inferred ? `${FACET_LABELS[facet]}: ${value} (guessed from the recipe)` : `${FACET_LABELS[facet]}: ${value}`,
          },
          labelled ? h('span', { class: 'badge-facet' }, `${FACET_LABELS[facet]} `) : h('span', { class: 'visually-hidden' }, `${FACET_LABELS[facet]}: `),
          value,
          inferred ? h('span', { class: 'visually-hidden' }, ' (guessed)') : null,
        ),
      );
    }
  }
  return items.length ? h('ul', { class: 'badges', role: 'list' }, items) : null;
}

/**
 * Recipe image, or a neutral placeholder when there is none or it fails to load.
 * @param {string | null} ref path relative to the recipes folder, or absolute URL
 * @param {{ className: string, eager?: boolean }} options
 */
export function recipeImage(ref, { className, eager = false }) {
  const placeholder = () => h('div', { class: `${className} media-placeholder` }, icon('bowl'));
  const src = recipesUrl(ref);
  if (!src) return placeholder();
  const img = h('img', {
    class: className,
    src,
    alt: '',
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
  });
  img.addEventListener('error', () => img.replaceWith(placeholder()), { once: true });
  return img;
}

/**
 * Full-page message (errors, not found, empty states).
 * @param {{ title: string, body?: (string | Node)[], action?: Node | null, tone?: 'error' | 'info' }} options
 */
export function messageView({ title, body = [], action = null, tone = 'info' }) {
  return h(
    'main',
    { id: 'main', class: `message message-${tone}` },
    h('div', { class: 'message-icon' }, icon(tone === 'error' ? 'alert' : 'bowl')),
    h('h1', { tabindex: '-1' }, title),
    body.map((b) => (typeof b === 'string' ? h('p', null, b) : b)),
    action,
  );
}

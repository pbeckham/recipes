// Recipe view (R9). Cooking helpers (scaling, check-off, wake lock, print)
// arrive in phase 4.

import { h, icon } from '../dom.js';
import { formatMinutes, nutritionEntries, nutritionLabel } from '../format.js';
import { badges, recipeImage } from './common.js';

/** @param {[string, string][]} facts */
function factList(facts) {
  const shown = facts.filter(([, v]) => v);
  if (!shown.length) return null;
  return h(
    'dl',
    { class: 'facts' },
    shown.map(([label, value]) => h('div', { class: 'fact' }, h('dt', null, label), h('dd', null, value))),
  );
}

/** @param {import('../jsonld.js').Recipe} recipe */
function ingredientsSection(recipe) {
  return h(
    'section',
    { class: 'ingredients', 'aria-labelledby': 'ingredients-title' },
    h('h2', { id: 'ingredients-title' }, 'Ingredients'),
    recipe.ingredients.length
      ? h('ul', { class: 'ingredient-list', role: 'list' }, recipe.ingredients.map((line) => h('li', null, line)))
      : h('p', { class: 'muted' }, 'No ingredients listed.'),
  );
}

/** @param {import('../jsonld.js').Recipe} recipe */
function methodSection(recipe) {
  return h(
    'section',
    { class: 'method', 'aria-labelledby': 'method-title' },
    h('h2', { id: 'method-title' }, 'Method'),
    recipe.instructions.length
      ? recipe.instructions.map((section) =>
          h(
            'div',
            { class: 'method-section' },
            section.name ? h('h3', null, section.name) : null,
            h('ol', { class: 'step-list', role: 'list' }, section.steps.map((step) => h('li', null, h('p', null, step)))),
          ),
        )
      : h('p', { class: 'muted' }, 'No method given.'),
  );
}

/** @param {import('../jsonld.js').Recipe} recipe @param {any} entry */
function moreSection(recipe, entry) {
  const nutrition = nutritionEntries(recipe.nutrition);
  const meta = [
    recipe.cuisine.length ? ['Cuisine', recipe.cuisine.join(', ')] : null,
    recipe.keywords.length ? ['Tags', recipe.keywords.join(', ')] : null,
    recipe.author ? ['By', recipe.author] : null,
  ].filter(Boolean);
  if (!nutrition.length && !meta.length && !recipe.url) return null;
  return h(
    'footer',
    { class: 'recipe-more' },
    nutrition.length
      ? h(
          'details',
          { class: 'nutrition' },
          h('summary', null, 'Nutrition', recipe.yield ? h('span', { class: 'muted' }, ' (per serving)') : null),
          h('dl', null, nutrition.map(([k, v]) => h('div', null, h('dt', null, nutritionLabel(k)), h('dd', null, v)))),
        )
      : null,
    meta.length ? h('dl', { class: 'recipe-meta' }, meta.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))) : null,
    recipe.url
      ? h(
          'p',
          null,
          h('a', { class: 'source-link', href: recipe.url, rel: 'noopener noreferrer', target: '_blank' }, icon('link'), 'Original recipe'),
        )
      : null,
    h('p', { class: 'muted small' }, `File: ${entry.file}`),
  );
}

/**
 * Recipe page. Rendered first with only the index entry (recipe = null) so
 * the title and image appear immediately, then again once the file loads.
 * @param {any} entry index entry
 * @param {import('../jsonld.js').Recipe | null} recipe
 * @param {{ error?: string }} [state]
 */
export function renderRecipe(entry, recipe, { error } = {}) {
  const anyInferred = (entry.inferred ?? []).some((f) => entry[f]?.length);
  const facts = recipe
    ? [
        ['Prep', formatMinutes(recipe.prepMinutes)],
        ['Cook', formatMinutes(recipe.cookMinutes)],
        ['Total', formatMinutes(recipe.totalMinutes)],
        ['Makes', recipe.yield],
      ]
    : [['Total', formatMinutes(entry.totalMinutes)], ['Makes', entry.yield]];

  let body;
  if (error) {
    body = h('div', { class: 'notice notice-error', role: 'alert' }, icon('alert'), h('p', null, error));
  } else if (!recipe) {
    body = h('p', { class: 'loading', role: 'status' }, 'Loading recipe…');
  } else {
    body = [h('div', { class: 'recipe-body' }, ingredientsSection(recipe), methodSection(recipe)), moreSection(recipe, entry)];
  }

  const description = recipe?.description ?? entry.description;
  const imageRef = entry.image ?? recipe?.image ?? null;
  return h(
    'main',
    { id: 'main', class: 'recipe' },
    h(
      'article',
      null,
      h(
        'header',
        { class: imageRef ? 'recipe-head' : 'recipe-head no-image' },
        // No placeholder here: an empty box would waste the first screen on a phone.
        imageRef ? recipeImage(imageRef, { className: 'recipe-media', eager: true }) : null,
        h(
          'div',
          { class: 'recipe-intro' },
          h('h1', { tabindex: '-1' }, entry.name),
          description ? description.split('\n').map((p) => h('p', { class: 'recipe-description' }, p)) : null,
          badges(entry, { labelled: true }),
          anyInferred ? h('p', { class: 'muted small' }, 'Dashed categories were guessed from the recipe.') : null,
          factList(facts),
        ),
      ),
      body,
    ),
  );
}

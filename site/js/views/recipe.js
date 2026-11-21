// Recipe view (R9) with cooking helpers (R10–R13): serving scaler,
// tick-off ingredients and steps, keep-screen-on, print.

import { h, icon } from '../dom.js';
import { formatMinutes, nutritionEntries, nutritionLabel } from '../format.js';
import { scaleLine, formatAmount, maxServings } from '../scale.js';
import { loadCookState, saveCookState } from '../cooking.js';
import { badges, recipeImage } from './common.js';

/** "From The Sample Kitchen, p. 12", linking to the book's other recipes. */
function bookLine(entry) {
  if (!entry.book) return null;
  const guessed = entry.inferred?.includes('book');
  return h(
    'p',
    { class: 'recipe-book' },
    icon('book'),
    h('span', null, 'From ', h('a', { href: `#/?${new URLSearchParams({ book: entry.book })}` }, entry.book), entry.page ? `, p. ${entry.page}` : ''),
    guessed ? h('span', { class: 'muted small' }, ' (matched by title)') : null,
  );
}

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

/** A tickable row: a real checkbox (keyboard and screen-reader friendly) styled as the whole row. */
function tickRow({ checked, onChange, marker, content, className }) {
  const input = h('input', { type: 'checkbox', class: 'tick-input', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('li', { class: className }, h('label', { class: 'tick' }, input, marker, content));
}

/** Yield text is a plain count of servings ("4", "4 servings", "Serves 6")? */
const isServingsYield = (text) => /^(serves\s+)?\d+(\.\d+)?(\s*(servings?|people|persons|portions))?$/i.test(text.trim());

/** Multipliers offered when the yield isn't a number of servings ("1 loaf"). */
const FACTORS = [0.5, 1, 1.5, 2, 3, 4];

/**
 * Servings stepper, or a ×½…×4 multiplier when the yield isn't a count of servings.
 * @param {import('../jsonld.js').Recipe} recipe
 * @param {() => number} getFactor
 * @param {(factor: number) => void} setFactor
 */
function scaler(recipe, getFactor, setFactor) {
  const servingsMode = recipe.servings != null && isServingsYield(recipe.yield || String(recipe.servings));
  const base = recipe.servings ?? 1;
  const value = h('output', { class: 'stepper-value', 'aria-live': 'polite' });
  const minus = h('button', { type: 'button', class: 'stepper-button' }, '−');
  const plus = h('button', { type: 'button', class: 'stepper-button' }, '+');
  const reset = h('button', { type: 'button', class: 'link-button stepper-reset' }, 'Reset');
  const note = servingsMode ? null : h('span', { class: 'stepper-note muted' }, recipe.yield ? `of the recipe (makes ${recipe.yield})` : 'of the recipe');

  const current = () => (servingsMode ? Math.round(getFactor() * base) : getFactor());
  const steps = servingsMode ? Array.from({ length: maxServings(base) }, (_, i) => i + 1) : FACTORS;
  const toFactor = (v) => (servingsMode ? v / base : v);

  function refresh() {
    const v = current();
    value.textContent = servingsMode ? `${v} ${v === 1 ? 'serving' : 'servings'}` : `×${formatAmount(v)}`;
    minus.disabled = v <= steps[0];
    plus.disabled = v >= steps.at(-1);
    minus.setAttribute('aria-label', servingsMode ? 'Fewer servings' : 'Smaller quantity');
    plus.setAttribute('aria-label', servingsMode ? 'More servings' : 'Larger quantity');
    reset.hidden = Math.abs(getFactor() - 1) < 1e-9;
  }
  const move = (dir) => {
    const v = current();
    const next = dir > 0 ? steps.find((s) => s > v + 1e-9) : [...steps].reverse().find((s) => s < v - 1e-9);
    if (next != null) setFactor(toFactor(next));
  };
  minus.addEventListener('click', () => move(-1));
  plus.addEventListener('click', () => move(1));
  reset.addEventListener('click', () => setFactor(1));

  const el = h(
    'div',
    { class: 'scaler', role: 'group', 'aria-label': servingsMode ? 'Servings' : 'Recipe quantity' },
    h('span', { class: 'tool-label' }, servingsMode ? 'Servings' : 'Quantity'),
    h('div', { class: 'stepper' }, minus, value, plus),
    note,
    reset,
  );
  return { el, refresh };
}

/**
 * Ingredients, method and cooking tools, wired to this session's state.
 * @param {any} entry
 * @param {import('../jsonld.js').Recipe} recipe
 * @param {ReturnType<import('../cooking.js').createWakeLock>} wakeLock
 */
function cookingBody(entry, recipe, wakeLock) {
  const state = loadCookState(entry.id);
  const save = () => saveCookState(entry.id, state);

  // --- ingredients
  const ingList = h('ul', { class: 'ingredient-list', role: 'list' });
  function renderIngredients() {
    ingList.replaceChildren(
      ...recipe.ingredients.map((line, i) => {
        const { before, qty, after } = scaleLine(line, state.factor);
        const content = h('span', { class: 'tick-text' }, before, qty != null ? h('span', { class: state.factor === 1 ? 'qty' : 'qty qty-scaled' }, qty) : null, after);
        return tickRow({
          checked: state.ingredients.includes(i),
          className: 'ingredient',
          marker: h('span', { class: 'tick-box', 'aria-hidden': 'true' }),
          content,
          onChange: (on) => {
            state.ingredients = on ? [...state.ingredients, i] : state.ingredients.filter((x) => x !== i);
            save();
            refreshClear();
          },
        });
      }),
    );
  }

  // --- method
  const method = recipe.instructions.map((section, si) =>
    h(
      'div',
      { class: 'method-section' },
      section.name ? h('h3', null, section.name) : null,
      h(
        'ol',
        { class: 'step-list', role: 'list' },
        section.steps.map((step, i) => {
          const key = `${si}.${i}`;
          return tickRow({
            checked: state.steps.includes(key),
            className: 'step',
            marker: h('span', { class: 'step-marker', 'aria-hidden': 'true' }),
            content: h('p', { class: 'tick-text' }, step),
            onChange: (on) => {
              state.steps = on ? [...state.steps, key] : state.steps.filter((x) => x !== key);
              save();
              refreshClear();
            },
          });
        }),
      ),
    ),
  );

  // Printed pages don't show the stepper, so say when quantities are scaled.
  const printNote = h('p', { class: 'print-only scale-note' });
  const refreshPrintNote = () => {
    const f = state.factor;
    printNote.textContent =
      Math.abs(f - 1) < 1e-9
        ? ''
        : recipe.servings && isServingsYield(recipe.yield || String(recipe.servings))
          ? `Quantities scaled to ${Math.round(f * recipe.servings)} servings.`
          : `Quantities scaled ×${formatAmount(f)}.`;
  };

  // --- tools
  const sc = scaler(
    recipe,
    () => state.factor,
    (f) => {
      state.factor = f;
      save();
      sc.refresh();
      renderIngredients();
      refreshPrintNote();
    },
  );
  const clearTicks = h('button', { type: 'button', class: 'link-button' }, 'Clear ticks');
  clearTicks.addEventListener('click', () => {
    state.ingredients = [];
    state.steps = [];
    save();
    for (const input of body.querySelectorAll('.tick-input')) input.checked = false;
    refreshClear();
  });
  function refreshClear() {
    clearTicks.hidden = !state.ingredients.length && !state.steps.length;
  }

  let wakeToggle = null;
  if (wakeLock) {
    wakeToggle = h('button', { type: 'button', class: 'tool-toggle', 'aria-pressed': String(wakeLock.on) }, icon('sun'), 'Keep screen on');
    wakeToggle.addEventListener('click', () => wakeLock.set(!wakeLock.on));
    // Unsubscribes itself once this page has been left.
    const unsubscribe = wakeLock.subscribe((on) => {
      if (!wakeToggle.isConnected) return unsubscribe();
      wakeToggle.setAttribute('aria-pressed', String(on));
    });
  }
  const printButton = h('button', { type: 'button', class: 'tool-toggle', onclick: () => window.print() }, icon('print'), 'Print');

  const tools = h(
    'div',
    { class: 'cook-tools' },
    recipe.ingredients.length ? sc.el : null,
    h('div', { class: 'tool-buttons' }, wakeToggle, printButton),
  );

  const body = h(
    'div',
    { class: 'recipe-body' },
    h(
      'section',
      { class: 'ingredients', 'aria-labelledby': 'ingredients-title' },
      h('div', { class: 'section-head' }, h('h2', { id: 'ingredients-title' }, 'Ingredients'), clearTicks),
      printNote,
      recipe.ingredients.length ? ingList : h('p', { class: 'muted' }, 'No ingredients listed.'),
    ),
    h(
      'section',
      { class: 'method', 'aria-labelledby': 'method-title' },
      h('h2', { id: 'method-title' }, 'Method'),
      method.length ? method : h('p', { class: 'muted' }, 'No method given.'),
      recipe.instructions.length ? h('p', { class: 'tick-hint muted small' }, 'Tap an ingredient or step to tick it off.') : null,
    ),
  );

  renderIngredients();
  sc.refresh();
  refreshPrintNote();
  refreshClear();
  return [tools, body];
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
 * @param {{ error?: string, wakeLock?: ReturnType<import('../cooking.js').createWakeLock> }} [options]
 */
export function renderRecipe(entry, recipe, { error, wakeLock = null } = {}) {
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
    body = [...cookingBody(entry, recipe, wakeLock), moreSection(recipe, entry)];
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
          bookLine(entry),
          anyInferred ? h('p', { class: 'muted small' }, 'Dashed categories were guessed from the recipe.') : null,
          factList(facts),
        ),
      ),
      body,
    ),
  );
}

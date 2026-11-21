// Filter sheet (R7, R18, R19): a bottom sheet on phones, a side panel on
// tablets. Built once; update() refreshes checked states and counts in place so
// focus and typing are never interrupted.

import { h, icon } from '../dom.js';
import { FACETS, FACET_LABELS, FACET_VALUES } from '../taxonomy.js';
import { TIME_PRESETS, suggestIngredients } from '../search.js';

/** "≤ 30 min" */
export const timeLabel = (minutes) => `≤ ${minutes < 60 ? `${minutes} min` : `${minutes / 60} hr${minutes > 60 ? 's' : ''}`}`.replace('1.5 hrs', '1½ hrs');

let uid = 0;

/**
 * A checkbox or radio styled as a chip, with a match count.
 * @param {{ type: 'checkbox' | 'radio', name: string, value: string, label: string }} o
 */
function option({ type, name, value, label }) {
  const input = h('input', { type, name, value, class: 'option-input' });
  const count = h('span', { class: 'option-count' });
  const el = h('label', { class: 'option' }, input, h('span', { class: 'option-label' }, label), count);
  return { el, input, count };
}

/**
 * @param {object} options
 * @param {{ term: string, count: number }[]} options.vocabulary
 * @param {string[]} options.cuisines
 * @param {string[]} [options.books]   cookbook names
 * @param {(patch: Partial<import('../search.js').SearchState>) => void} options.onChange
 */
export function createFilterSheet({ vocabulary, cuisines, books = [], onChange }) {
  const id = `sheet-${++uid}`;
  let state = null;

  // --- category facets (+ cuisine)
  const groups = [...FACETS.map((f) => ({ key: f, label: FACET_LABELS[f], values: FACET_VALUES[f] }))];
  if (books.length) groups.push({ key: 'book', label: 'Book', values: books });
  if (cuisines.length) groups.push({ key: 'cuisine', label: 'Cuisine', values: cuisines });

  const facetOptions = {};
  const facetFieldsets = groups.map(({ key, label, values }) => {
    facetOptions[key] = values.map((value) => {
      const o = option({ type: 'checkbox', name: key, value, label: value });
      o.input.addEventListener('change', () => {
        const chosen = new Set(state[key]);
        if (o.input.checked) chosen.add(value);
        else chosen.delete(value);
        onChange({ [key]: values.filter((v) => chosen.has(v)) });
      });
      return o;
    });
    return h('fieldset', { class: 'filter-group' }, h('legend', null, label), h('div', { class: 'options' }, facetOptions[key].map((o) => o.el)));
  });

  // --- time
  const timeOptions = [null, ...TIME_PRESETS].map((t) => {
    const o = option({ type: 'radio', name: `${id}-time`, value: t ? String(t) : '', label: t ? timeLabel(t) : 'Any time' });
    o.input.addEventListener('change', () => o.input.checked && onChange({ maxTime: t }));
    return { ...o, minutes: t };
  });
  const timeNote = h('p', { class: 'filter-note' });
  const timeFieldset = h(
    'fieldset',
    { class: 'filter-group' },
    h('legend', null, 'Total time'),
    h('div', { class: 'options' }, timeOptions.map((o) => o.el)),
    timeNote,
  );

  // --- ingredients (must include all)
  const ingInput = h('input', {
    type: 'text',
    id: `${id}-ing`,
    class: 'text-input',
    placeholder: 'e.g. chicken, lemon',
    autocomplete: 'off',
    autocapitalize: 'none',
    enterkeyhint: 'done',
    'aria-describedby': `${id}-ing-help`,
  });
  const chosenList = h('ul', { class: 'chips', role: 'list' });
  const suggestList = h('ul', { class: 'suggestions', role: 'list', 'aria-label': 'Suggestions' });
  const addIngredient = (term) => {
    const t = term.trim().toLowerCase();
    if (!t || state.ing.includes(t)) return;
    ingInput.value = '';
    onChange({ ing: [...state.ing, t] });
    ingInput.focus();
  };
  ingInput.addEventListener('input', () => renderSuggestions());
  ingInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = suggestIngredients(vocabulary, ingInput.value, state.ing, 1)[0];
      // Prefer the typed text when it exactly matches a term or nothing is suggested.
      const typed = ingInput.value.trim();
      addIngredient(first && !vocabulary.some((v) => v.term === typed.toLowerCase()) ? first.term : typed);
    }
  });
  const ingFieldset = h(
    'fieldset',
    { class: 'filter-group' },
    h('legend', null, 'Must include'),
    h('p', { class: 'filter-note', id: `${id}-ing-help` }, 'Recipes must contain every ingredient you add.'),
    chosenList,
    h('label', { class: 'visually-hidden', for: `${id}-ing` }, 'Add an ingredient'),
    ingInput,
    suggestList,
  );

  function renderSuggestions() {
    const items = suggestIngredients(vocabulary, ingInput.value, state.ing, 8);
    suggestList.replaceChildren(
      ...items.map((v) =>
        h(
          'li',
          null,
          h(
            'button',
            { type: 'button', class: 'suggestion', onclick: () => addIngredient(v.term), 'aria-label': `Add ${v.term} (${v.count} recipes)` },
            h('span', { 'aria-hidden': 'true' }, '+ '),
            v.term,
            h('span', { class: 'option-count', 'aria-hidden': 'true' }, String(v.count)),
          ),
        ),
      ),
    );
  }

  // --- sheet chrome
  const showButton = h('button', { type: 'button', class: 'button sheet-show' });
  const clearButton = h('button', { type: 'button', class: 'link-button' }, 'Clear all');
  const closeButton = h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close filters' }, icon('close'));
  const dialog = h(
    'dialog',
    { class: 'sheet', 'aria-labelledby': `${id}-title` },
    h('div', { class: 'sheet-head' }, h('h2', { id: `${id}-title` }, 'Filters'), closeButton),
    h('div', { class: 'sheet-body' }, facetFieldsets.slice(0, 3), timeFieldset, ingFieldset, facetFieldsets.slice(3)),
    h('div', { class: 'sheet-foot' }, clearButton, showButton),
  );

  const close = () => dialog.open && dialog.close();
  closeButton.addEventListener('click', close);
  showButton.addEventListener('click', close);
  clearButton.addEventListener('click', () => onChange({ meal: [], protein: [], carb: [], cuisine: [], book: [], ing: [], maxTime: null }));
  // Tapping the backdrop closes the sheet.
  dialog.addEventListener('click', (e) => e.target === dialog && close());

  /**
   * Refresh from the current state and search result.
   * @param {import('../search.js').SearchState} next
   * @param {import('../search.js').SearchResult} result
   */
  function update(next, result) {
    state = next;
    for (const { key } of groups) {
      for (const o of facetOptions[key]) {
        const checked = state[key].includes(o.input.value);
        const n = result.counts[key].get(o.input.value) ?? 0;
        o.input.checked = checked;
        o.input.disabled = !checked && n === 0;
        o.count.textContent = String(n);
      }
    }
    for (const o of timeOptions) {
      o.input.checked = o.minutes === state.maxTime;
      if (o.minutes == null) {
        o.count.textContent = '';
      } else {
        const n = result.counts.time.get(o.minutes) ?? 0;
        o.count.textContent = String(n);
        o.input.disabled = !o.input.checked && n === 0;
      }
    }
    timeNote.textContent = result.hiddenNoTime
      ? `${result.hiddenNoTime} ${result.hiddenNoTime === 1 ? 'recipe has' : 'recipes have'} no time and ${result.hiddenNoTime === 1 ? 'is' : 'are'} hidden.`
      : '';
    chosenList.replaceChildren(
      ...state.ing.map((t) =>
        h(
          'li',
          null,
          h('button', { type: 'button', class: 'chip', 'aria-label': `Remove ${t}`, onclick: () => onChange({ ing: state.ing.filter((x) => x !== t) }) }, t, icon('close')),
        ),
      ),
    );
    renderSuggestions();
    const n = result.results.length;
    showButton.textContent = n ? `Show ${n} ${n === 1 ? 'recipe' : 'recipes'}` : 'No matches';
  }

  return {
    dialog,
    update,
    open() {
      if (!dialog.open) dialog.showModal();
    },
    close,
  };
}

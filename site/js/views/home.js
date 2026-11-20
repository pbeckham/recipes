// Home view: search, filters, sort and the recipe list (R5–R8, R18, R19, N6).

import { h, icon } from '../dom.js';
import { formatMinutes } from '../format.js';
import { FACETS } from '../taxonomy.js';
import { prepareIndex, search, serializeState, activeFilterCount, effectiveSort, queryWords, cuisineValues, emptyState, SORTS } from '../search.js';
import { createFilterSheet, timeLabel } from './filters.js';
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
 * @returns {() => void} stops loading further batches
 */
function renderIncrementally(recipes, list, sentinel) {
  let shown = 0;
  let observer = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    observer?.disconnect();
    sentinel.hidden = true;
  };

  const nearEnd = () => sentinel.isConnected && sentinel.getBoundingClientRect().top < window.innerHeight + LOOKAHEAD_PX;
  const more = () => {
    if (stopped) return;
    const next = recipes.slice(shown, shown + BATCH_SIZE);
    list.append(...next.map(card));
    shown += next.length;
    if (shown >= recipes.length) return stop();
    // A tall screen may still show the sentinel after appending: keep going.
    requestAnimationFrame(() => nearEnd() && more());
  };

  list.replaceChildren(...recipes.slice(0, BATCH_SIZE).map(card));
  shown = Math.min(BATCH_SIZE, recipes.length);
  sentinel.hidden = false;
  if (shown >= recipes.length) {
    stop();
  } else if (!('IntersectionObserver' in window)) {
    list.append(...recipes.slice(shown).map(card));
    stop();
  } else {
    observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && more(), {
      rootMargin: `0px 0px ${LOOKAHEAD_PX}px 0px`,
    });
    observer.observe(sentinel);
  }
  return stop;
}

/** Chips for the active filters, each removable. */
function activeChips(state, onChange) {
  const chips = [];
  const chip = (label, srLabel, patch) =>
    chips.push(
      h('li', null, h('button', { type: 'button', class: 'chip', 'aria-label': `Remove filter: ${srLabel}`, onclick: () => onChange(patch) }, label, icon('close'))),
    );
  for (const key of [...FACETS, 'cuisine']) {
    for (const v of state[key]) chip(v, v, { [key]: state[key].filter((x) => x !== v) });
  }
  if (state.maxTime) chip(timeLabel(state.maxTime), `total time ${timeLabel(state.maxTime)}`, { maxTime: null });
  for (const t of state.ing) chip(`with ${t}`, `must include ${t}`, { ing: state.ing.filter((x) => x !== t) });
  return chips;
}

/**
 * Build the home view for an index. Returns a controller: the node is kept
 * and reused across navigation; setState() re-renders only what changed.
 * @param {{ recipes: any[], ingredientVocabulary?: { term: string, count: number }[] }} index
 * @param {{ onStateChange?: (state: import('../search.js').SearchState) => void }} [options]
 */
export function createHome(index, { onStateChange = () => {} } = {}) {
  const { recipes } = index;
  if (!recipes.length) {
    const node = messageView({
      title: 'No recipes yet',
      body: [
        'The recipe index is empty. Add schema.org Recipe files (.json or .jsonld) to the recipes folder, then rebuild the index:',
        h('pre', null, h('code', null, 'node tools/build-index.mjs <recipes-folder>')),
      ],
    });
    return { index, node, state: emptyState(), setState() {} };
  }

  const prepared = prepareIndex(recipes);
  let state = emptyState();
  let stopBatches = () => {};

  const searchInput = h('input', {
    type: 'search',
    id: 'search',
    class: 'search-input',
    placeholder: 'Search recipes',
    autocomplete: 'off',
    enterkeyhint: 'search',
    'aria-controls': 'results',
  });
  const filterCount = h('span', { class: 'filter-count', 'aria-hidden': 'true' });
  const filterButton = h('button', { type: 'button', class: 'filter-button', 'aria-haspopup': 'dialog' }, icon('filter'), h('span', { class: 'filter-button-label' }, 'Filters'), filterCount);
  const chipList = h('ul', { class: 'chips active-chips', role: 'list', 'aria-label': 'Active filters' });
  const clearAll = h('button', { type: 'button', class: 'link-button' }, 'Clear all');
  const chipRow = h('div', { class: 'chip-row' }, chipList, clearAll);
  const resultCount = h('p', { class: 'result-count', role: 'status', 'aria-live': 'polite' });
  const sortSelect = h('select', { id: 'sort', class: 'sort-select' });
  const list = h('ul', { class: 'card-list', id: 'results', role: 'list' });
  const sentinel = h('div', { class: 'list-sentinel', 'aria-hidden': 'true' });
  const empty = h('div', { class: 'no-results', hidden: true });

  const sheet = createFilterSheet({
    vocabulary: index.ingredientVocabulary ?? [],
    cuisines: cuisineValues(recipes),
    onChange: (patch) => apply({ ...state, ...patch }),
  });

  const node = h(
    'main',
    { class: 'home' },
    h('h1', { class: 'visually-hidden', tabindex: '-1' }, 'All recipes'),
    h(
      'div',
      { class: 'home-toolbar' },
      h(
        'div',
        { class: 'search-row' },
        h('label', { class: 'search-field' }, icon('search'), h('span', { class: 'visually-hidden' }, 'Search recipes'), searchInput),
        filterButton,
      ),
      chipRow,
    ),
    h('div', { class: 'results-head' }, resultCount, h('label', { class: 'sort' }, h('span', { class: 'sort-label' }, 'Sort'), sortSelect)),
    list,
    sentinel,
    empty,
    sheet.dialog,
  );

  let typingTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => apply({ ...state, q: searchInput.value }), 120);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchInput.blur(); // closes the phone keyboard to reveal results
  });
  sortSelect.addEventListener('change', () => apply({ ...state, sort: sortSelect.value }));
  filterButton.addEventListener('click', () => sheet.open());
  clearAll.addEventListener('click', () => apply({ ...emptyState(), q: state.q, sort: state.sort }));

  function renderSortOptions() {
    const hasQuery = queryWords(state.q).length > 0;
    const current = effectiveSort(state);
    sortSelect.replaceChildren(
      ...Object.entries(SORTS)
        .filter(([key]) => key !== 'relevance' || hasQuery)
        .map(([key, label]) => h('option', { value: key, selected: key === current }, label)),
    );
    sortSelect.value = current;
  }

  /** Re-render everything that depends on the state. */
  function render() {
    const result = search(prepared, state);
    const n = result.results.length;
    const active = activeFilterCount(state);

    if (searchInput.value !== state.q && document.activeElement !== searchInput) searchInput.value = state.q;
    filterCount.textContent = active ? String(active) : '';
    filterButton.setAttribute('aria-label', active ? `Filters, ${active} active` : 'Filters');
    filterButton.classList.toggle('is-active', active > 0);
    chipList.replaceChildren(...activeChips(state, (patch) => apply({ ...state, ...patch })));
    chipRow.hidden = active === 0;

    const noun = (k) => (k === 1 ? 'recipe' : 'recipes');
    let text = n === recipes.length ? `${n} ${noun(n)}` : `${n} of ${recipes.length} ${noun(recipes.length)}`;
    if (result.hiddenNoTime) text += ` · ${result.hiddenNoTime} without a time hidden`;
    resultCount.textContent = text;
    renderSortOptions();

    stopBatches();
    if (n) {
      empty.hidden = true;
      list.hidden = false;
      stopBatches = renderIncrementally(result.results, list, sentinel);
    } else {
      list.hidden = true;
      list.replaceChildren();
      sentinel.hidden = true;
      empty.hidden = false;
      empty.replaceChildren(
        h('p', { class: 'no-results-title' }, 'No recipes match'),
        h('p', { class: 'muted' }, 'Try fewer filters or a different search.'),
        h(
          'div',
          { class: 'no-results-actions' },
          state.q ? h('button', { type: 'button', class: 'button button-secondary', onclick: () => apply({ ...state, q: '' }) }, 'Clear search') : null,
          active ? h('button', { type: 'button', class: 'button', onclick: () => apply({ ...emptyState(), q: state.q, sort: state.sort }) }, 'Clear filters') : null,
        ),
      );
    }
    sheet.update(state, result);
  }

  /** Change state from a user action: re-render, update the URL, show the top of the results. */
  function apply(next) {
    const changed = serializeState(next) !== serializeState(state) || next.q !== state.q;
    state = next;
    if (!changed) return;
    render();
    onStateChange(state);
    const toolbar = node.querySelector('.home-toolbar');
    if (toolbar && window.scrollY > 0 && !sheet.dialog.open) window.scrollTo(0, 0);
  }

  render();

  return {
    index,
    node,
    get state() {
      return state;
    },
    /** Set state from the URL (no URL update). */
    setState(next) {
      state = next;
      searchInput.value = next.q;
      render();
    },
  };
}

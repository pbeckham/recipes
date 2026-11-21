// Search, filtering and sorting over the in-memory index (R6–R8, R18, R19).
// Pure functions, no DOM: shared with unit tests.

import { normalizeText, containsTerm } from './text.js';
import { FACETS, FACET_VALUES } from './taxonomy.js';

/** Cooking-time presets in minutes (R18). */
export const TIME_PRESETS = [15, 30, 45, 60, 90];

/** Sort options. 'relevance' is only offered while there is a search query. */
export const SORTS = {
  relevance: 'Best match',
  name: 'Name A–Z',
  time: 'Quickest first',
  newest: 'Newest first',
};

/** Filters with several values, in URL order. */
const LIST_KEYS = ['meal', 'protein', 'carb', 'cuisine', 'book', 'ing'];

// Words that carry no meaning in a recipe search ("pasta with beef").
const QUERY_STOPWORDS = new Set(['a', 'an', 'and', 'the', 'with', 'of', 'in', 'for', 'or', 'on', 'to']);

/**
 * @typedef {object} SearchState
 * @property {string} q            free-text query
 * @property {string[]} meal
 * @property {string[]} protein
 * @property {string[]} carb
 * @property {string[]} cuisine
 * @property {string[]} book       cookbook names
 * @property {string[]} ing        ingredients that must all be present
 * @property {number | null} maxTime  minutes, one of TIME_PRESETS
 * @property {string} sort         '' = default (relevance with a query, else name)
 */

/** @returns {SearchState} */
export function emptyState() {
  return { q: '', meal: [], protein: [], carb: [], cuisine: [], book: [], ing: [], maxTime: null, sort: '' };
}

const unique = (arr) => [...new Set(arr)];

/**
 * Parse the query part of the home URL ("q=soup&meal=Main&time=30").
 * Unknown keys and invalid values are ignored.
 * @param {string} query
 * @returns {SearchState}
 */
export function parseState(query) {
  const params = new URLSearchParams(query);
  const state = emptyState();
  state.q = (params.get('q') ?? '').slice(0, 200);
  for (const facet of FACETS) {
    state[facet] = unique(params.getAll(facet).filter((v) => FACET_VALUES[facet].includes(v)));
  }
  state.cuisine = unique(params.getAll('cuisine').map((v) => v.trim()).filter(Boolean));
  state.book = unique(params.getAll('book').map((v) => v.trim()).filter(Boolean));
  state.ing = unique(params.getAll('ing').map((v) => normalizeText(v)).filter(Boolean));
  const time = Number(params.get('time'));
  state.maxTime = TIME_PRESETS.includes(time) ? time : null;
  const sort = params.get('sort') ?? '';
  state.sort = sort in SORTS ? sort : '';
  return state;
}

/**
 * Serialize a state for the URL, in a stable order, omitting defaults.
 * @param {SearchState} state
 * @returns {string} without a leading "?"
 */
export function serializeState(state) {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  for (const key of LIST_KEYS) for (const v of state[key]) params.append(key, v);
  if (state.maxTime) params.set('time', String(state.maxTime));
  if (state.sort) params.set('sort', state.sort);
  return params.toString();
}

/** Number of active filters (everything except the query and sort). */
export function activeFilterCount(state) {
  return LIST_KEYS.reduce((n, k) => n + state[k].length, 0) + (state.maxTime ? 1 : 0);
}

/** The sort actually applied for a state. */
export const effectiveSort = (state) => state.sort || (queryWords(state.q).length ? 'relevance' : 'name');

/** @param {string} q */
export function queryWords(q) {
  return normalizeText(q)
    .split(' ')
    .filter((w) => w && !QUERY_STOPWORDS.has(w));
}

/**
 * @typedef {object} Prepared
 * @property {any} entry      the index entry
 * @property {string} name    normalized name
 * @property {string} text    normalized searchable text (name, description, tags, categories, ingredients)
 * @property {string[]} lines normalized ingredient lines
 */

/**
 * Precompute normalized text once per index load.
 * @param {any[]} recipes index entries
 * @returns {Prepared[]}
 */
export function prepareIndex(recipes) {
  return recipes.map((entry) => {
    const lines = entry.ingredients.map(normalizeText);
    const text = normalizeText(
      [entry.name, entry.description, ...entry.keywords, ...entry.cuisine, ...entry.meal, ...entry.protein, ...entry.carb, ...entry.ingredients].join(' \n '),
    );
    return { entry, name: normalizeText(entry.name), text, lines };
  });
}

const wordStart = new Map();
/** Regex matching a word starting with w ("chick" → "chicken"). */
function prefixRegex(w) {
  if (!wordStart.has(w)) wordStart.set(w, new RegExp(`(?:^| )${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  return wordStart.get(w);
}

/**
 * Relevance of a recipe for the query words, or 0 if any word is missing.
 * Every word must match the start of a word somewhere; matches in the
 * name score higher.
 * @param {Prepared} p
 * @param {string[]} words
 */
export function textScore(p, words) {
  let score = 0;
  for (const w of words) {
    const re = prefixRegex(w);
    if (re.test(p.name)) score += 10;
    else if (re.test(p.text)) score += 1;
    else return 0;
  }
  return score;
}

const anyOf = (selected, values) => !selected.length || selected.some((v) => values.includes(v));

/**
 * @typedef {object} SearchResult
 * @property {any[]} results          matching index entries, sorted
 * @property {number} hiddenNoTime    recipes hidden only because they have no known time
 * @property {Record<string, Map<string, number>>} counts  per filter: value → matches if that value were (also) chosen;
 *                                    keys meal, protein, carb, cuisine, book, time (preset → count)
 */

/**
 * Filter, count and sort.
 * Facet values combine with OR within a facet and AND across facets (R7).
 * Counts for a facet ignore that facet's own selection, so they show what
 * choosing a value would give.
 * @param {Prepared[]} prepared
 * @param {SearchState} state
 * @returns {SearchResult}
 */
export function search(prepared, state) {
  const words = queryWords(state.q);
  const scores = new Map();

  // Each recipe's pass/fail per filter group, so counts can drop one group.
  const rows = [];
  for (const p of prepared) {
    const e = p.entry;
    const score = words.length ? textScore(p, words) : 1;
    if (!score) continue; // text and ingredients apply everywhere, counts included
    if (state.ing.length && !state.ing.every((t) => p.lines.some((line) => containsTerm(line, t)))) continue;
    scores.set(e, score);
    rows.push({
      e,
      meal: anyOf(state.meal, e.meal),
      protein: anyOf(state.protein, e.protein),
      carb: anyOf(state.carb, e.carb),
      cuisine: anyOf(state.cuisine, e.cuisine),
      book: anyOf(state.book, e.book ? [e.book] : []),
      time: !state.maxTime || (e.totalMinutes != null && e.totalMinutes <= state.maxTime),
    });
  }

  const groups = ['meal', 'protein', 'carb', 'cuisine', 'book', 'time'];
  const passesExcept = (row, skip) => groups.every((g) => g === skip || row[g]);

  const counts = { meal: new Map(), protein: new Map(), carb: new Map(), cuisine: new Map(), book: new Map(), time: new Map() };
  for (const facet of FACETS) for (const v of FACET_VALUES[facet]) counts[facet].set(v, 0);
  for (const t of TIME_PRESETS) counts.time.set(t, 0);

  const results = [];
  let hiddenNoTime = 0;
  for (const row of rows) {
    const { e } = row;
    if (passesExcept(row, null)) results.push(e);
    for (const facet of ['meal', 'protein', 'carb', 'cuisine', 'book']) {
      if (!passesExcept(row, facet)) continue;
      const values = facet === 'book' ? (e.book ? [e.book] : []) : e[facet];
      for (const v of values) counts[facet].set(v, (counts[facet].get(v) ?? 0) + 1);
    }
    if (passesExcept(row, 'time')) {
      if (e.totalMinutes == null) {
        if (state.maxTime) hiddenNoTime += 1;
      } else {
        for (const t of TIME_PRESETS) if (e.totalMinutes <= t) counts.time.set(t, counts.time.get(t) + 1);
      }
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  const sorters = {
    name: byName,
    relevance: (a, b) => scores.get(b) - scores.get(a) || byName(a, b),
    time: (a, b) => (a.totalMinutes ?? Infinity) - (b.totalMinutes ?? Infinity) || byName(a, b),
    newest: (a, b) => (b.added ?? '').localeCompare(a.added ?? '') || byName(a, b),
  };
  results.sort(sorters[effectiveSort(state)]);
  return { results, hiddenNoTime, counts };
}

/**
 * All cuisines in the index, most common first.
 * @param {any[]} recipes
 * @returns {string[]}
 */
export function cuisineValues(recipes) {
  const counts = new Map();
  for (const r of recipes) for (const c of r.cuisine) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

/**
 * Ingredient suggestions for what the user has typed: vocabulary terms with a
 * word starting with the input, most used first. Empty input → most used.
 * @param {{ term: string, count: number }[]} vocabulary
 * @param {string} input
 * @param {string[]} exclude already chosen terms
 * @param {number} [limit]
 */
export function suggestIngredients(vocabulary, input, exclude = [], limit = 8) {
  const q = normalizeText(input);
  const re = q ? prefixRegex(q) : null;
  const out = vocabulary.filter((v) => !exclude.includes(v.term) && (!re || re.test(v.term)));
  // Terms that start with the input beat ones where a later word does.
  const late = (v) => Number(!v.term.startsWith(q));
  out.sort((a, b) => late(a) - late(b) || b.count - a.count || a.term.localeCompare(b.term));
  return out.slice(0, limit);
}

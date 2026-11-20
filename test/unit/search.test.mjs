import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyState,
  parseState,
  serializeState,
  activeFilterCount,
  effectiveSort,
  queryWords,
  prepareIndex,
  search,
  cuisineValues,
  suggestIngredients,
} from '../../site/js/search.js';
import { buildIndex } from '../../tools/build-index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { index } = await buildIndex(path.join(root, 'samples/recipes'));
const prepared = prepareIndex(index.recipes);
const names = (r) => r.results.map((e) => e.name);
const ids = (r) => r.results.map((e) => e.id);
const run = (query) => search(prepared, parseState(query));

test('parseState/serializeState round-trip, stable order, defaults omitted', () => {
  const s = parseState('sort=time&time=30&carb=Rice&meal=Main&meal=Soup&q=+chicken+&ing=Garlic&cuisine=Spanish');
  assert.deepEqual(s, {
    q: ' chicken ',
    meal: ['Main', 'Soup'],
    protein: [],
    carb: ['Rice'],
    cuisine: ['Spanish'],
    ing: ['garlic'],
    maxTime: 30,
    sort: 'time',
  });
  assert.equal(serializeState(s), 'q=chicken&meal=Main&meal=Soup&carb=Rice&cuisine=Spanish&ing=garlic&time=30&sort=time');
  assert.deepEqual(parseState(serializeState(s)), { ...s, q: 'chicken' });
  assert.equal(serializeState(emptyState()), '');
});

test('parseState ignores invalid values', () => {
  const s = parseState('meal=Brunch&protein=Unicorn&protein=Poultry&protein=Poultry&time=20&sort=random&carb=');
  assert.deepEqual(s.meal, []);
  assert.deepEqual(s.protein, ['Poultry']);
  assert.equal(s.maxTime, null);
  assert.equal(s.sort, '');
  assert.equal(parseState('q=' + 'x'.repeat(500)).q.length, 200);
});

test('"&" in facet values survives the URL', () => {
  const s = { ...emptyState(), protein: ['Fish & Seafood'], meal: ['Sauce & Condiment'] };
  assert.deepEqual(parseState(serializeState(s)), s);
});

test('activeFilterCount and effectiveSort', () => {
  assert.equal(activeFilterCount(parseState('q=x&meal=Main&protein=Beef&protein=Pork&time=30&ing=egg&sort=time')), 5);
  assert.equal(effectiveSort(parseState('')), 'name');
  assert.equal(effectiveSort(parseState('q=soup')), 'relevance');
  assert.equal(effectiveSort(parseState('q=the')), 'name'); // only stopwords
  assert.equal(effectiveSort(parseState('q=soup&sort=time')), 'time');
});

test('queryWords drops stopwords and folds accents', () => {
  assert.deepEqual(queryWords('Pasta with BEEF ragù'), ['pasta', 'beef', 'ragu']);
});

test('no filters: everything, sorted by name', () => {
  const r = run('');
  assert.equal(r.results.length, index.recipes.length);
  assert.deepEqual(names(r), [...names(r)].sort((a, b) => a.localeCompare(b)));
});

test('text search: all words must match a word start, case and accent-insensitive', () => {
  assert.deepEqual(ids(run('q=ragu')), ['mains/slow-cooked-beef-ragu']);
  assert.deepEqual(ids(run('q=RAGÙ')), ['mains/slow-cooked-beef-ragu']);
  assert.ok(ids(run('q=chick')).includes('soups/chicken-noodle-soup'), 'prefix match');
  assert.ok(!ids(run('q=hick')).length, 'no mid-word matches');
  assert.deepEqual(ids(run('q=chicken noodle')), ['soups/chicken-noodle-soup']);
  assert.deepEqual(ids(run('q=chicken unicorn')), []);
});

test('text search covers ingredients, keywords, cuisine and categories', () => {
  assert.ok(ids(run('q=pappardelle')).includes('mains/slow-cooked-beef-ragu')); // ingredient
  assert.ok(ids(run('q=freezable')).includes('baking/banana-bread')); // keyword
  assert.ok(ids(run('q=spanish')).includes('mains/chicken-chorizo-rice')); // cuisine
  assert.ok(ids(run('q=vegetarian')).includes('sauces/basil-pesto')); // inferred category
});

test('relevance: name matches rank above ingredient matches', () => {
  const r = names(run('q=chicken'));
  const nameHits = r.filter((n) => /chicken/i.test(n));
  assert.ok(nameHits.length >= 2);
  assert.deepEqual(r.slice(0, nameHits.length), nameHits);
});

test('facets: OR within a facet, AND across facets', () => {
  const soupOrSalad = run('meal=Soup&meal=Salad').results;
  assert.equal(soupOrSalad.length, 4);
  assert.ok(soupOrSalad.every((e) => e.meal.includes('Soup') || e.meal.includes('Salad')));

  const mainAndRice = run('meal=Main&carb=Rice').results;
  assert.deepEqual(mainAndRice.map((e) => e.id), ['mains/chicken-chorizo-rice']);

  assert.deepEqual(ids(run('protein=Poultry&protein=Pork&carb=Potato')), ['salads/warm-potato-bacon-salad']);
});

test('facet counts ignore their own facet but respect the others', () => {
  const r = run('meal=Main');
  // Protein counts are within Main recipes.
  assert.equal(r.counts.protein.get('Poultry'), 1);
  assert.equal(r.counts.protein.get('Vegetarian'), 0);
  // Meal counts ignore the Main selection: what you'd get by adding each meal.
  assert.equal(r.counts.meal.get('Soup'), 2);
  assert.equal(r.counts.meal.get('Main'), 5);
  // Counts also respect the text query.
  const q = run('q=soup');
  assert.equal(q.counts.meal.get('Soup'), 2);
  assert.equal(q.counts.meal.get('Dessert'), 0);
});

test('time filter: presets on total time; recipes without a time are hidden and counted', () => {
  const r = run('time=15');
  assert.ok(r.results.length > 0);
  assert.ok(r.results.every((e) => e.totalMinutes != null && e.totalMinutes <= 15));
  assert.equal(r.hiddenNoTime, 1); // basil pesto
  assert.equal(run('').hiddenNoTime, 0);
  const counts = run('').counts.time;
  assert.ok(counts.get(15) < counts.get(30) && counts.get(30) <= counts.get(90));
  assert.equal(counts.get(90), index.recipes.filter((e) => e.totalMinutes != null && e.totalMinutes <= 90).length);
});

test('sorting by time puts unknown times last; newest uses the added date', () => {
  const r = run('sort=time').results;
  const times = r.map((e) => e.totalMinutes);
  assert.equal(times.at(-1), null);
  const known = times.filter((t) => t != null);
  assert.deepEqual(known, [...known].sort((a, b) => a - b));

  const fake = prepareIndex([
    { ...index.recipes[0], id: 'old', name: 'B', added: '2020-01-01T00:00:00Z' },
    { ...index.recipes[1], id: 'new', name: 'A', added: '2026-01-01T00:00:00Z' },
    { ...index.recipes[2], id: 'mid', name: 'C', added: '2024-01-01T00:00:00Z' },
  ]);
  assert.deepEqual(search(fake, parseState('sort=newest')).results.map((e) => e.id), ['new', 'mid', 'old']);
});

test('ingredient filter: must include all, whole words, plural-tolerant', () => {
  const garlic = run('ing=garlic').results;
  assert.ok(garlic.length >= 8);
  assert.ok(garlic.every((e) => e.ingredients.some((l) => /garlic/i.test(l))));

  const both = ids(run('ing=chicken&ing=chorizo'));
  assert.deepEqual(both, ['mains/chicken-chorizo-rice']);

  assert.ok(ids(run('ing=tomato')).includes('soups/roast-tomato-soup'), '"tomato" matches "tomatoes"');
  assert.ok(ids(run('ing=prawns')).includes('starters/prawn-cocktail-lettuce-cups'));
  assert.deepEqual(ids(run('ing=chick')), [], 'no partial words');
  assert.ok(!ids(run('ing=chicken')).includes('snacks/crispy-spiced-chickpeas'));
});

test('ingredient filter applies to counts too', () => {
  const r = run('ing=chicken');
  const total = [...r.counts.meal.values()].reduce((a, b) => a + b, 0);
  assert.ok(total >= r.results.length && r.results.length > 0);
  assert.equal(r.counts.meal.get('Dessert'), 0);
});

test('cuisineValues lists cuisines, most common first', () => {
  const c = cuisineValues(index.recipes);
  assert.ok(c.includes('Italian') && c.includes('British'));
  assert.equal(c[0], 'British');
});

test('suggestIngredients: prefix of any word, most used first, excluding chosen', () => {
  const vocab = [
    { term: 'garlic', count: 10 },
    { term: 'olive oil', count: 9 },
    { term: 'oil', count: 12 },
    { term: 'spring onion', count: 3 },
    { term: 'onion', count: 9 },
  ];
  assert.deepEqual(suggestIngredients(vocab, 'oni').map((v) => v.term), ['onion', 'spring onion']);
  assert.deepEqual(suggestIngredients(vocab, 'OIL').map((v) => v.term), ['oil', 'olive oil']);
  assert.deepEqual(suggestIngredients(vocab, '', ['oil'], 2).map((v) => v.term), ['garlic', 'olive oil']);
  assert.deepEqual(suggestIngredients(vocab, 'zzz'), []);
});

test('performance: 1,500 recipes filter in well under a frame budget', () => {
  const big = prepareIndex(Array.from({ length: 80 }, (_, i) => index.recipes.map((r) => ({ ...r, id: `${r.id}-${i}` }))).flat());
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) search(big, parseState('q=chick&meal=Main&meal=Soup&ing=garlic&time=60'));
  const per = (performance.now() - t0) / 20;
  assert.ok(per < 30, `${per.toFixed(1)} ms per search`);
});

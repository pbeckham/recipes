import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, normalizeText, containsTerm, removeTerm, lastTermEnd, singularize, ingredientTerms } from '../../site/js/text.js';

test('fold strips accents and lowercases', () => {
  assert.equal(fold('Crème Brûlée'), 'creme brulee');
  assert.equal(fold(null), '');
});

test('normalizeText reduces to plain tokens', () => {
  assert.equal(normalizeText("Fish & Seafood"), 'fish and seafood');
  assert.equal(normalizeText("  Lamb's lettuce, to serve! "), 'lamb s lettuce to serve');
  assert.equal(normalizeText('Jalapeño'), 'jalapeno');
});

test('containsTerm matches whole words and simple plurals', () => {
  const t = normalizeText('2 tomatoes, diced');
  assert.ok(containsTerm(t, 'tomato'));
  assert.ok(containsTerm(normalizeText('3 Anchovies'), 'anchovy'));
  assert.ok(containsTerm(normalizeText('250 g prawns'), 'prawn'));
  assert.ok(containsTerm(normalizeText('olive oil'), 'olive oil'));
  assert.ok(!containsTerm(normalizeText('400 g chickpeas'), 'chicken'));
  assert.ok(!containsTerm(normalizeText('hamburger buns'), 'ham'));
  assert.ok(!containsTerm(normalizeText('monkfish'), 'fish'));
});

test('removeTerm removes every occurrence and reports it', () => {
  const r = removeTerm(normalizeText('1 tbsp fish sauce and more fish sauce'), 'fish sauce');
  assert.equal(r.found, true);
  assert.equal(r.text, '1 tbsp and more');
  assert.deepEqual(removeTerm('beef', 'pork'), { text: 'beef', found: false });
});

test('lastTermEnd finds the last occurrence', () => {
  assert.equal(lastTermEnd('bread sauce', 'sauce'), 11);
  assert.equal(lastTermEnd('bread sauce', 'bread'), 5);
  assert.equal(lastTermEnd('bread sauce', 'soup'), -1);
});

test('singularize handles common ingredient plurals', () => {
  assert.equal(singularize('tomatoes'), 'tomato');
  assert.equal(singularize('cherries'), 'cherry');
  assert.equal(singularize('cloves'), 'clove');
  assert.equal(singularize('radishes'), 'radish');
  assert.equal(singularize('couscous'), 'couscous');
  assert.equal(singularize('hummus'), 'hummus');
  assert.equal(singularize('peas'), 'pea');
});

test('ingredientTerms extracts names, not quantities or preparation', () => {
  assert.deepEqual(ingredientTerms('2 large garlic cloves, crushed'), ['garlic', 'clove', 'garlic clove']);
  assert.deepEqual(ingredientTerms('1 x 400 g tin chopped tomatoes'), ['tomato']);
  assert.deepEqual(ingredientTerms('Salt and pepper'), ['salt', 'pepper']);
  assert.deepEqual(ingredientTerms('100 g feta (crumbled)'), ['feta']);
  assert.deepEqual(ingredientTerms('1 red onion'), ['onion', 'red onion']);
  assert.deepEqual(ingredientTerms('Juice of 1 lemon'), ['lemon']);
  assert.deepEqual(ingredientTerms('1 tsp smoked paprika'), ['paprika', 'smoked paprika']);
});

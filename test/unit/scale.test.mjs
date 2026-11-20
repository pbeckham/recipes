import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseLine, formatAmount, scaleLine, hasUnit, roundCount } from '../../site/js/scale.js';

const scaled = (line, f) => {
  const r = scaleLine(line, f);
  return r.before + (r.qty ?? '') + r.after;
};

test('parseAmount: integers, decimals, fractions, mixed, glyphs', () => {
  assert.equal(parseAmount('2'), 2);
  assert.equal(parseAmount('1.5'), 1.5);
  assert.equal(parseAmount('1,5'), 1.5);
  assert.equal(parseAmount('1/2'), 0.5);
  assert.equal(parseAmount('1 1/2'), 1.5);
  assert.equal(parseAmount('½'), 0.5);
  assert.equal(parseAmount('1½'), 1.5);
  assert.equal(parseAmount('1 ½'), 1.5);
  assert.ok(Math.abs(parseAmount('⅓') - 1 / 3) < 1e-9);
  assert.equal(parseAmount('1/0'), null);
  assert.equal(parseAmount('abc'), null);
});

test('parseLine: finds the leading quantity and range', () => {
  assert.deepEqual(parseLine('2 eggs'), { lead: '', amount: 2, amountTo: null, sep: '', rest: ' eggs', decimal: false });
  assert.deepEqual(parseLine('2-3 garlic cloves'), { lead: '', amount: 2, amountTo: 3, sep: '-', rest: ' garlic cloves', decimal: false });
  assert.equal(parseLine('2 to 3 sprigs').amountTo, 3);
  assert.equal(parseLine('1.2 litres stock').decimal, true);
  assert.equal(parseLine('500g flour').rest, 'g flour');
  assert.equal(parseLine('Juice of 1 lemon'), null);
  assert.equal(parseLine('A pinch of salt'), null);
  assert.equal(parseLine('0 g sugar'), null);
});

test('formatAmount: friendly numbers', () => {
  assert.equal(formatAmount(4), '4');
  assert.equal(formatAmount(0.5), '½');
  assert.equal(formatAmount(1.5), '1½');
  assert.equal(formatAmount(0.25), '¼');
  assert.equal(formatAmount(2 / 3), '⅔');
  assert.equal(formatAmount(0.75), '¾');
  assert.equal(formatAmount(1.99), '2');
  assert.equal(formatAmount(2.4, { decimal: true }), '2.4');
  assert.equal(formatAmount(0.6, { decimal: true }), '0.6');
  assert.equal(formatAmount(12.5), '13');
  assert.equal(formatAmount(375), '375');
  assert.equal(formatAmount(333.33), '335');
  assert.equal(formatAmount(1666.7), '1670');
  assert.equal(formatAmount(1.45), '1.4'); // not near a nice fraction
});

test('scaleLine: doubling and halving common lines', () => {
  assert.equal(scaled('2 eggs', 2), '4 eggs');
  assert.equal(scaled('500 g pappardelle', 1.5), '750 g pappardelle');
  assert.equal(scaled('500g flour', 0.5), '250g flour');
  assert.equal(scaled('1 1/2 tbsp soy sauce', 2), '3 tbsp soy sauce');
  assert.equal(scaled('1/2 tsp ground cinnamon', 0.5), '¼ tsp ground cinnamon');
  assert.equal(scaled('½ cucumber, diced', 3), '1½ cucumber, diced');
  assert.equal(scaled('2-3 garlic cloves', 2), '4-6 garlic cloves');
  assert.equal(scaled('1.2 litres chicken stock', 2), '2.4 litres chicken stock');
  assert.equal(scaled('1 x 400 g tin chopped tomatoes', 2), '2 x 400 g tin chopped tomatoes');
  assert.equal(scaled('3 eggs', 1 / 3), '1 eggs');
  assert.equal(scaled('4 chicken thighs', 0.75), '3 chicken thighs');
});

test('hasUnit tells measured amounts from counted items', () => {
  for (const r of [' g flour', 'g flour', ' kg beef', ' ml milk', ' tbsp oil', ' tsp salt', ' cups rice', ' oz cheese', ' lb mince', ' litres stock', ' fl oz cream']) {
    assert.ok(hasUnit(r), r);
  }
  for (const r of [' eggs', ' onion, chopped', ' x 400 g tin tomatoes', ' garlic cloves', ' large carrots', ' lemons', ' grapes']) {
    assert.ok(!hasUnit(r), r);
  }
});

test('counted items round to usable amounts; measured amounts keep precision', () => {
  assert.equal(roundCount(4 / 3), 1.5);
  assert.equal(roundCount(8 / 3), 3);
  assert.equal(roundCount(0.2), 0.5);
  assert.equal(scaled('1 onion, finely chopped', 8 / 6), '1½ onion, finely chopped');
  assert.equal(scaled('2 carrots', 8 / 6), '3 carrots');
  assert.equal(scaled('2 x 400 g tins chopped tomatoes', 8 / 6), '3 x 400 g tins chopped tomatoes');
  assert.equal(scaled('2 bay leaves', 8 / 6), '3 bay leaves');
  assert.equal(scaled('3 eggs', 0.5), '1½ eggs');
  assert.equal(scaled('2 tbsp olive oil', 8 / 6), '2⅔ tbsp olive oil');
  assert.equal(scaled('250 ml red wine', 8 / 6), '335 ml red wine');
});

test('scaleLine: lines without a leading quantity are unchanged', () => {
  for (const line of ['Juice of 1 lemon', 'A handful of basil', 'Salt and pepper', 'Crusty bread, to serve', '']) {
    assert.deepEqual(scaleLine(line, 2), { before: '', qty: null, after: line });
  }
});

test('scaleLine: factor 1 returns the original text, quantity separated', () => {
  assert.deepEqual(scaleLine('1 ½ cups milk', 1), { before: '', qty: '1 ½', after: ' cups milk' });
  assert.deepEqual(scaleLine('  2 eggs', 1), { before: '  ', qty: '2', after: ' eggs' });
});

test('every sample ingredient line survives a round trip at factor 1', async () => {
  const { buildIndex } = await import('../../tools/build-index.mjs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const { index } = await buildIndex(path.join(root, 'samples/recipes'));
  for (const r of index.recipes) for (const line of r.ingredients) assert.equal(scaled(line, 1), line);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFacetValue, inferProtein, inferCarb, inferMeal, categorize, FACET_VALUES } from '../../site/js/taxonomy.js';
import { extractRecipe } from '../../site/js/jsonld.js';

test('resolveFacetValue: canonical values, case and spacing', () => {
  for (const [facet, values] of Object.entries(FACET_VALUES)) {
    for (const v of values) {
      assert.equal(resolveFacetValue(facet, v), v);
      assert.equal(resolveFacetValue(facet, v.toUpperCase()), v);
    }
  }
  assert.equal(resolveFacetValue('protein', 'fish and seafood'), 'Fish & Seafood');
  assert.equal(resolveFacetValue('carb', 'none/other'), 'None / Other');
});

test('resolveFacetValue: synonyms', () => {
  assert.equal(resolveFacetValue('meal', 'Main course'), 'Main');
  assert.equal(resolveFacetValue('meal', 'Dinner'), 'Main');
  assert.equal(resolveFacetValue('meal', 'Entrée'), 'Main');
  assert.equal(resolveFacetValue('meal', 'Appetiser'), 'Starter');
  assert.equal(resolveFacetValue('meal', 'Side dish'), 'Side');
  assert.equal(resolveFacetValue('meal', 'Sauces'), 'Sauce & Condiment');
  assert.equal(resolveFacetValue('protein', 'Chicken'), 'Poultry');
  assert.equal(resolveFacetValue('protein', 'duck'), 'Poultry');
  assert.equal(resolveFacetValue('protein', 'Fish'), 'Fish & Seafood');
  assert.equal(resolveFacetValue('protein', 'vegan'), 'Vegetarian');
  assert.equal(resolveFacetValue('carb', 'None'), 'None / Other');
  assert.equal(resolveFacetValue('carb', 'potatoes'), 'Potato');
  assert.equal(resolveFacetValue('meal', 'Italian'), null);
  assert.equal(resolveFacetValue('protein', 'Unicorn'), null);
});

test('inferProtein: main ingredients', () => {
  assert.deepEqual(inferProtein(['6 chicken thighs', '100 g chorizo']), ['Poultry', 'Pork']);
  assert.deepEqual(inferProtein(['2 duck breasts']), ['Poultry']);
  assert.deepEqual(inferProtein(['250 g king prawns']), ['Fish & Seafood']);
  assert.deepEqual(inferProtein(['500 g lamb mince']), ['Lamb']);
  assert.deepEqual(inferProtein(['1 kg venison']), ['Other']);
});

test('inferProtein: no meat or fish → Vegetarian', () => {
  assert.deepEqual(inferProtein(['2 eggs', '100 g cheddar', '600 ml vegetable stock']), ['Vegetarian']);
  assert.deepEqual(inferProtein([]), ['Vegetarian']);
});

test('inferProtein trap: fish sauce in a beef dish is not fish', () => {
  assert.deepEqual(inferProtein(['400 g beef steak', '2 tbsp fish sauce']), ['Beef']);
});

test('inferProtein trap: chicken stock makes a dish non-vegetarian but not Poultry', () => {
  assert.deepEqual(inferProtein(['300 g arborio rice', '1 litre chicken stock', '250 g mushrooms']), []);
  assert.deepEqual(inferProtein(['2 anchovies', 'spaghetti']), []);
  assert.deepEqual(inferProtein(['1 sachet gelatine', 'cream']), []);
});

test('inferProtein traps: things that only look like meat or fish', () => {
  assert.deepEqual(inferProtein(["Lamb's lettuce, to serve"]), ['Vegetarian']);
  assert.deepEqual(inferProtein(['2 beef tomatoes']), ['Vegetarian']);
  assert.deepEqual(inferProtein(['4 vegetarian sausages']), ['Vegetarian']);
  assert.deepEqual(inferProtein(['400 g chickpeas']), ['Vegetarian']);
  assert.deepEqual(inferProtein(['1 tbsp vegan fish sauce']), ['Vegetarian']);
});

test('inferCarb: main carbs', () => {
  assert.deepEqual(inferCarb(['500 g pappardelle']), ['Pasta']);
  assert.deepEqual(inferCarb(['250 g basmati rice']), ['Rice']);
  assert.deepEqual(inferCarb(['750 g new potatoes']), ['Potato']);
  assert.deepEqual(inferCarb(['500 g gnocchi']), ['Potato']);
  assert.deepEqual(inferCarb(['150 g couscous']), ['Grains']);
  assert.deepEqual(inferCarb(['4 flatbreads']), ['Bread']);
  assert.deepEqual(inferCarb(['200 g udon noodles']), ['Noodles']);
});

test('inferCarb traps', () => {
  assert.deepEqual(inferCarb(['200 g rice noodles']), ['Noodles']);
  assert.deepEqual(inferCarb(['50 g panko breadcrumbs', '2 chicken breasts']), ['None / Other']);
  assert.deepEqual(inferCarb(['50 g breadcrumbs']), ['None / Other']);
  assert.deepEqual(inferCarb(['1 tbsp rice vinegar']), ['None / Other']);
  assert.deepEqual(inferCarb(['225 g self-raising flour']), ['None / Other']);
  assert.deepEqual(inferCarb([]), ['None / Other']);
});

test('inferMeal: the head noun of the name wins', () => {
  assert.deepEqual(inferMeal({ name: 'Bread Sauce' }), ['Sauce & Condiment']);
  assert.deepEqual(inferMeal({ name: 'Banana Bread' }), ['Baking']);
  assert.deepEqual(inferMeal({ name: 'Roast Tomato Soup with Crusty Bread' }), ['Soup']);
  assert.deepEqual(inferMeal({ name: 'Green Salad, Lemon Dressing' }), ['Salad']);
  assert.deepEqual(inferMeal({ name: 'Basil Pesto' }), ['Sauce & Condiment']);
});

test('inferMeal: falls back to keywords and categories, else nothing', () => {
  assert.deepEqual(inferMeal({ name: 'Grandma’s Special', keywords: ['dessert'] }), ['Dessert']);
  assert.deepEqual(inferMeal({ name: 'Grandma’s Special', categories: ['Christmas dinner'] }), ['Main']);
  assert.deepEqual(inferMeal({ name: 'Grandma’s Special' }), []);
});

test('categorize: explicit values win per facet, the rest are inferred', () => {
  const r = extractRecipe({
    '@type': 'Recipe',
    name: 'Mystery Bake',
    recipeCategory: 'Main course',
    keywords: 'protein:Chicken, weeknight',
    recipeIngredient: ['2 chicken breasts', '250 g penne'],
  });
  const c = categorize(r);
  assert.deepEqual(c.meal, ['Main']);
  assert.deepEqual(c.protein, ['Poultry']);
  assert.deepEqual(c.carb, ['Pasta']);
  assert.deepEqual(c.inferred, ['carb']);
  assert.deepEqual(c.warnings, []);
});

test('categorize: explicit tag overrides what inference would say', () => {
  const r = extractRecipe({
    '@type': 'Recipe',
    name: 'Stew',
    keywords: 'meal:Main, protein:Other, carb:None',
    recipeIngredient: ['1 kg venison', '200 g bacon lardons', '500 g potatoes'],
  });
  const c = categorize(r);
  assert.deepEqual([c.meal, c.protein, c.carb, c.inferred], [['Main'], ['Other'], ['None / Other'], []]);
});

test('categorize: unknown tags warn and fall back to inference', () => {
  const r = extractRecipe({ '@type': 'Recipe', name: 'Odd Soup', keywords: 'protein:Unicorn', recipeIngredient: ['2 eggs'] });
  const c = categorize(r);
  assert.deepEqual(c.protein, ['Vegetarian']);
  assert.ok(c.inferred.includes('protein'));
  assert.equal(c.warnings.length, 1);
  assert.match(c.warnings[0], /unknown protein tag "Unicorn"/);
});

test('categorize: multiple values keep canonical order', () => {
  const r = extractRecipe({ '@type': 'Recipe', name: 'Surf and Turf', keywords: 'protein:Beef, protein:Prawns, protein:Seafood' });
  const c = categorize(r);
  // "Prawns" is not a tag synonym: it warns; Seafood resolves.
  assert.deepEqual(c.protein, ['Fish & Seafood', 'Beef']);
  assert.equal(c.warnings.length, 1);
});

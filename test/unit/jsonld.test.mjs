import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  parseDuration,
  findRecipeNode,
  extractRecipe,
  parseInstructions,
  textList,
  resolveRelativePath,
} from '../../site/js/jsonld.js';

const base = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Test' };

test('parseDuration: ISO 8601', () => {
  assert.equal(parseDuration('PT1H30M'), 90);
  assert.equal(parseDuration('PT45M'), 45);
  assert.equal(parseDuration('PT90M'), 90);
  assert.equal(parseDuration('P1DT2H'), 1560);
  assert.equal(parseDuration('PT0.5H'), 30);
  assert.equal(parseDuration('PT1H30M30S'), 91);
  assert.equal(parseDuration('pt20m'), 20);
});

test('parseDuration: loose text, junk and zero', () => {
  assert.equal(parseDuration('1 hour 20 mins'), 80);
  assert.equal(parseDuration('25 minutes'), 25);
  assert.equal(parseDuration('PT0M'), null);
  assert.equal(parseDuration('PT'), null);
  assert.equal(parseDuration('soon'), null);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration(undefined), null);
  assert.equal(parseDuration(15), 15);
});

test('cleanText strips HTML and decodes entities', () => {
  assert.equal(cleanText('Salt &amp; pepper'), 'Salt & pepper');
  assert.equal(cleanText('<p>Mix <b>well</b>.</p><p>Bake.</p>'), 'Mix well.\nBake.');
  assert.equal(cleanText('Caf&eacute; &#8211; 200&deg;C &#x2014; &frac12; cup'), 'Café – 200°C — ½ cup');
  assert.equal(cleanText('<script>alert(1)</script>ok'), 'alert(1)ok');
  assert.equal(cleanText({ '@value': 'x' }), 'x');
  assert.equal(cleanText(null), '');
});

test('findRecipeNode: single object', () => {
  assert.equal(findRecipeNode(base), base);
});

test('findRecipeNode: top-level array', () => {
  const doc = [{ '@type': 'Person', name: 'x' }, base];
  assert.equal(findRecipeNode(doc), base);
});

test('findRecipeNode: @graph container', () => {
  const doc = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, base] };
  assert.equal(findRecipeNode(doc), base);
});

test('findRecipeNode: nested in mainEntity', () => {
  const doc = { '@type': 'WebPage', mainEntity: base };
  assert.equal(findRecipeNode(doc), base);
});

test('findRecipeNode: @type arrays and prefixed types', () => {
  const a = { '@type': ['CreativeWork', 'Recipe'], name: 'A' };
  const b = { '@type': 'schema:Recipe', name: 'B' };
  const c = { '@type': 'http://schema.org/Recipe', name: 'C' };
  assert.equal(findRecipeNode(a), a);
  assert.equal(findRecipeNode(b), b);
  assert.equal(findRecipeNode(c), c);
});

test('findRecipeNode: none', () => {
  assert.equal(findRecipeNode({ '@type': 'Person' }), null);
  assert.equal(findRecipeNode('nope'), null);
  assert.equal(findRecipeNode(null), null);
});

test('instructions: single string, numbered lines', () => {
  assert.deepEqual(parseInstructions('1. Boil water.\n2) Add pasta.\nStep 3: Drain.'), [
    { name: null, steps: ['Boil water.', 'Add pasta.', 'Drain.'] },
  ]);
});

test('instructions: array of strings', () => {
  assert.deepEqual(parseInstructions(['Mix.', 'Bake.']), [{ name: null, steps: ['Mix.', 'Bake.'] }]);
});

test('instructions: HowToStep with text, name only, and directions', () => {
  const steps = [
    { '@type': 'HowToStep', name: 'Prep', text: 'Chop the <b>onion</b>.' },
    { '@type': 'HowToStep', name: 'Only a name' },
    {
      '@type': 'HowToStep',
      itemListElement: [
        { '@type': 'HowToDirection', text: 'Stir.' },
        { '@type': 'HowToTip', text: 'Do not burn.' },
      ],
    },
  ];
  assert.deepEqual(parseInstructions(steps), [{ name: null, steps: ['Chop the onion.', 'Only a name', 'Stir. Do not burn.'] }]);
});

test('instructions: HowToSection with mixed items and loose steps around it', () => {
  const v = [
    'Before anything.',
    {
      '@type': 'HowToSection',
      name: 'Sauce',
      itemListElement: ['Melt butter.', { '@type': 'HowToStep', text: 'Add flour.' }],
    },
    { '@type': 'HowToSection', name: 'Empty', itemListElement: [] },
    { '@type': 'HowToStep', text: 'Serve.' },
  ];
  assert.deepEqual(parseInstructions(v), [
    { name: null, steps: ['Before anything.'] },
    { name: 'Sauce', steps: ['Melt butter.', 'Add flour.'] },
    { name: null, steps: ['Serve.'] },
  ]);
});

test('textList splits commas and de-duplicates case-insensitively', () => {
  assert.deepEqual(textList('Main course, Dinner,  main course'), ['Main course', 'Dinner']);
  assert.deepEqual(textList(['a, b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(textList(undefined), []);
});

test('normalizeRecipe: keywords string with facet prefixes', () => {
  const r = extractRecipe({ ...base, keywords: 'protein:Chicken, Carb : Rice, meal:Main, weeknight, one-pot' });
  assert.deepEqual(r.keywords, ['weeknight', 'one-pot']);
  assert.deepEqual(r.facetTags, { meal: ['Main'], protein: ['Chicken'], carb: ['Rice'] });
});

test('normalizeRecipe: keywords array', () => {
  const r = extractRecipe({ ...base, keywords: ['protein:Beef', 'quick'] });
  assert.deepEqual(r.keywords, ['quick']);
  assert.deepEqual(r.facetTags.protein, ['Beef']);
});

test('normalizeRecipe: image shapes', () => {
  assert.equal(extractRecipe({ ...base, image: 'a.jpg' }).image, 'a.jpg');
  assert.equal(extractRecipe({ ...base, image: ['a.jpg', 'b.jpg'] }).image, 'a.jpg');
  assert.equal(extractRecipe({ ...base, image: { '@type': 'ImageObject', url: 'c.jpg' } }).image, 'c.jpg');
  assert.equal(extractRecipe({ ...base, image: [{ '@type': 'ImageObject', contentUrl: 'd.jpg' }] }).image, 'd.jpg');
  assert.equal(extractRecipe(base).image, null);
});

test('normalizeRecipe: times, total derived from prep + cook', () => {
  const r = extractRecipe({ ...base, prepTime: 'PT10M', cookTime: 'PT30M' });
  assert.deepEqual([r.prepMinutes, r.cookMinutes, r.totalMinutes], [10, 30, 40]);
  assert.equal(extractRecipe({ ...base, prepTime: 'PT20M' }).totalMinutes, 20);
  assert.equal(extractRecipe({ ...base, prepTime: 'PT5M', totalTime: 'PT2H' }).totalMinutes, 120);
  assert.equal(extractRecipe(base).totalMinutes, null);
});

test('normalizeRecipe: yield shapes', () => {
  const y = (v) => {
    const r = extractRecipe({ ...base, recipeYield: v });
    return [r.yield, r.servings];
  };
  assert.deepEqual(y(4), ['4 servings', 4]);
  assert.deepEqual(y('4'), ['4 servings', 4]);
  assert.deepEqual(y('Serves 6'), ['Serves 6', 6]);
  assert.deepEqual(y(['8', '8 slices']), ['8 slices', 8]);
  assert.deepEqual(y('1 loaf'), ['1 loaf', 1]);
  assert.deepEqual(y(undefined), ['', null]);
});

test('normalizeRecipe: ingredients, author, source, nutrition, categories', () => {
  const r = extractRecipe({
    ...base,
    recipeIngredient: ['1 &frac12; cups flour', '', '  2 eggs '],
    author: [{ '@type': 'Person', name: 'A' }, 'B'],
    isBasedOn: { url: 'https://example.com/r' },
    nutrition: { '@type': 'NutritionInformation', calories: '200 kcal', fatContent: 5 },
    recipeCategory: 'Main course, Dinner',
    recipeCuisine: ['Italian'],
  });
  assert.deepEqual(r.ingredients, ['1 ½ cups flour', '2 eggs']);
  assert.equal(r.author, 'A, B');
  assert.equal(r.url, 'https://example.com/r');
  assert.deepEqual(r.nutrition, { calories: '200 kcal', fatContent: '5' });
  assert.deepEqual(r.categories, ['Main course', 'Dinner']);
  assert.deepEqual(r.cuisine, ['Italian']);
});

test('normalizeRecipe: ignores non-http source URLs', () => {
  assert.equal(extractRecipe({ ...base, url: 'javascript:alert(1)' }).url, null);
});

test('normalizeRecipe: legacy "ingredients" property', () => {
  assert.deepEqual(extractRecipe({ ...base, ingredients: ['salt'] }).ingredients, ['salt']);
});

test('resolveRelativePath', () => {
  assert.equal(resolveRelativePath('mains/lasagne.json', 'lasagne.jpg'), 'mains/lasagne.jpg');
  assert.equal(resolveRelativePath('mains/lasagne.json', './img/l.jpg'), 'mains/img/l.jpg');
  assert.equal(resolveRelativePath('mains/x/lasagne.json', '../l.jpg'), 'mains/l.jpg');
  assert.equal(resolveRelativePath('lasagne.json', 'l.jpg'), 'l.jpg');
  assert.equal(resolveRelativePath('a/b.json', 'https://example.com/i.jpg'), 'https://example.com/i.jpg');
  assert.equal(resolveRelativePath('a/b.json', '/images/i.jpg'), '/images/i.jpg');
});

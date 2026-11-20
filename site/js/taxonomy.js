// Category facets (Meal, Protein, Carb): fixed values, synonyms, and the
// rules for inferring values from a recipe that has no explicit tags.
// Shared by the browser app and tools/build-index.mjs. See README → Categories.

import { normalizeText, containsTerm, removeTerm, lastTermEnd } from './text.js';

/** @typedef {'meal' | 'protein' | 'carb'} Facet */

/** @type {Facet[]} */
export const FACETS = ['meal', 'protein', 'carb'];

export const FACET_LABELS = { meal: 'Meal', protein: 'Protein', carb: 'Carb' };

export const FACET_VALUES = {
  meal: ['Breakfast', 'Starter', 'Soup', 'Salad', 'Main', 'Side', 'Dessert', 'Baking', 'Snack', 'Sauce & Condiment', 'Drink'],
  protein: ['Fish & Seafood', 'Poultry', 'Beef', 'Pork', 'Lamb', 'Vegetarian', 'Other'],
  carb: ['Bread', 'Pasta', 'Noodles', 'Rice', 'Grains', 'Potato', 'None / Other'],
};

/** Label for a facet with no values. Not stored in the index. */
export const UNCATEGORISED = 'Uncategorised';

// Synonyms accepted in recipeCategory and in meal:/protein:/carb: keywords.
// Each value's own name is always accepted too.
const SYNONYMS = {
  meal: {
    Breakfast: ['brunch', 'breakfast and brunch'],
    Starter: ['starters', 'appetizer', 'appetizers', 'appetiser', 'appetisers', 'first course', 'hors d oeuvre', 'antipasti'],
    Soup: ['soups'],
    Salad: ['salads'],
    Main: ['mains', 'main course', 'main courses', 'main dish', 'main dishes', 'dinner', 'lunch', 'supper', 'entree', 'entrees'],
    Side: ['sides', 'side dish', 'side dishes', 'accompaniment', 'accompaniments'],
    Dessert: ['desserts', 'pudding', 'puddings', 'sweet', 'sweets'],
    Baking: ['bakes', 'baked goods', 'bread', 'breads', 'cake', 'cakes', 'biscuits', 'cookies', 'pastry', 'pastries'],
    Snack: ['snacks', 'nibbles', 'party food'],
    'Sauce & Condiment': ['sauce', 'sauces', 'condiment', 'condiments', 'dressing', 'dressings', 'preserves', 'dips', 'dip'],
    Drink: ['drinks', 'beverage', 'beverages', 'cocktail', 'cocktails'],
  },
  protein: {
    'Fish & Seafood': ['fish', 'seafood', 'shellfish'],
    Poultry: ['chicken', 'turkey', 'duck', 'goose'],
    Beef: ['veal'],
    Pork: ['ham', 'bacon'],
    Lamb: ['mutton'],
    Vegetarian: ['veggie', 'vegan', 'meat free', 'plant based', 'tofu'],
    Other: ['game', 'venison', 'rabbit', 'goat'],
  },
  carb: {
    Bread: ['breads'],
    Pasta: [],
    Noodles: ['noodle'],
    Rice: [],
    Grains: ['grain', 'cereal', 'cereals'],
    Potato: ['potatoes'],
    'None / Other': ['none', 'other', 'no carb', 'no carbs', 'low carb'],
  },
};

const LOOKUP = Object.fromEntries(
  FACETS.map((facet) => {
    const map = new Map();
    for (const value of FACET_VALUES[facet]) {
      map.set(normalizeText(value), value);
      for (const syn of SYNONYMS[facet][value] ?? []) map.set(normalizeText(syn), value);
    }
    return [facet, map];
  }),
);

/**
 * Map a raw tag or recipeCategory value to a facet value.
 * resolveFacetValue('meal', 'Main course') → 'Main'
 * @param {Facet} facet
 * @param {string} raw
 * @returns {string | null}
 */
export function resolveFacetValue(facet, raw) {
  return LOOKUP[facet].get(normalizeText(raw)) ?? null;
}

// ---------------------------------------------------------------- inference

// Meal: words in the recipe name (the last match wins, since English dish
// names end in the head noun: "Bread Sauce" is a sauce), then keywords and
// recipeCategory.
const MEAL_TERMS = {
  Breakfast: ['breakfast', 'brunch', 'porridge', 'granola', 'muesli', 'pancake', 'overnight oats', 'french toast', 'omelette', 'omelet'],
  Starter: ['starter', 'appetizer', 'appetiser', 'canape', 'bruschetta', 'pate'],
  Soup: ['soup', 'chowder', 'bisque', 'gazpacho', 'broth', 'minestrone', 'consomme'],
  Salad: ['salad', 'slaw', 'coleslaw', 'tabbouleh'],
  Main: ['main', 'dinner', 'supper', 'curry', 'stew', 'casserole', 'tagine', 'risotto', 'lasagne', 'lasagna', 'burger', 'chilli', 'chili', 'stir fry', 'roast', 'ragu', 'paella', 'kebab', 'kofta'],
  Side: ['side', 'side dish', 'mash', 'gratin', 'fried rice'],
  Dessert: ['dessert', 'pudding', 'crumble', 'cheesecake', 'mousse', 'posset', 'pavlova', 'trifle', 'sorbet', 'ice cream', 'tiramisu', 'panna cotta'],
  Baking: ['cake', 'cupcake', 'loaf', 'loaves', 'muffin', 'bread', 'focaccia', 'scone', 'cookie', 'biscuit', 'brownie', 'flapjack', 'traybake', 'bun', 'tart'],
  Snack: ['snack', 'dip', 'hummus', 'crisps', 'popcorn', 'energy ball'],
  'Sauce & Condiment': ['sauce', 'dressing', 'pesto', 'gravy', 'chutney', 'relish', 'jam', 'pickle', 'salsa', 'mayonnaise', 'ketchup', 'vinaigrette', 'condiment'],
  Drink: ['drink', 'smoothie', 'lemonade', 'cocktail', 'mocktail', 'cordial', 'hot chocolate', 'milkshake', 'punch'],
};

// Protein: main-ingredient terms, matched in ingredient lines.
const PROTEIN_TERMS = {
  'Fish & Seafood': [
    'fish', 'seafood', 'salmon', 'cod', 'haddock', 'hake', 'pollock', 'tuna', 'mackerel', 'trout', 'sea bass', 'sea bream',
    'monkfish', 'halibut', 'plaice', 'sole', 'kipper', 'sardine', 'swordfish', 'prawn', 'shrimp', 'crab', 'lobster',
    'mussel', 'clam', 'scallop', 'oyster', 'squid', 'calamari', 'octopus', 'crayfish', 'langoustine',
  ],
  Poultry: ['chicken', 'turkey', 'duck', 'goose', 'poussin', 'quail', 'guinea fowl', 'pheasant'],
  Beef: ['beef', 'steak', 'brisket', 'sirloin', 'ribeye', 'rib eye', 'fillet steak', 'oxtail', 'veal', 'short rib'],
  Pork: ['pork', 'bacon', 'ham', 'gammon', 'pancetta', 'prosciutto', 'chorizo', 'sausage', 'salami', 'guanciale', 'lardon', 'pepperoni', 'nduja'],
  Lamb: ['lamb', 'mutton', 'hogget'],
  Other: ['venison', 'rabbit', 'hare', 'goat', 'boar', 'wild boar', 'kangaroo', 'bison', 'partridge', 'pigeon'],
};

// Animal-derived flavourings and fats: they add no protein category, but a
// recipe containing them is not Vegetarian.
const NON_VEG_FLAVOURINGS = [
  'fish sauce', 'oyster sauce', 'shrimp paste', 'anchovy', 'anchovy paste', 'anchovy fillet', 'worcestershire sauce',
  'chicken stock', 'chicken broth', 'chicken stock cube', 'chicken bouillon', 'chicken gravy',
  'beef stock', 'beef broth', 'beef stock cube', 'beef bouillon', 'beef gravy', 'beef dripping',
  'fish stock', 'lamb stock', 'pork stock', 'ham stock', 'bone broth',
  'dripping', 'lard', 'suet', 'gelatine', 'gelatin', 'dashi', 'bonito',
];

// Phrases that look like a protein but aren't one. Removed before matching.
const PROTEIN_NEUTRAL = [
  'vegetable stock', 'vegetable broth', 'vegetable suet', 'veggie sausage', 'vegetarian sausage', 'vegan sausage',
  'beef tomato', 'lamb s lettuce', 'lambs lettuce', 'vegan fish sauce', 'vegetarian fish sauce', 'mushroom oyster sauce',
  'vegetarian worcestershire sauce', 'vegan worcestershire sauce', 'vegetarian gelatine', 'vegan gelatine',
];

// Carb: phrases resolved before single words, so "rice noodles" is Noodles,
// not Rice.
const CARB_PHRASES = {
  Noodles: ['rice noodle', 'rice vermicelli', 'glass noodle', 'egg noodle'],
};

const CARB_TERMS = {
  Bread: ['bread', 'baguette', 'ciabatta', 'focaccia', 'sourdough', 'brioche', 'bagel', 'bun', 'tortilla', 'flatbread', 'naan', 'pitta', 'pita', 'chapati', 'roti', 'crumpet'],
  Pasta: [
    'pasta', 'spaghetti', 'linguine', 'tagliatelle', 'fettuccine', 'pappardelle', 'penne', 'rigatoni', 'fusilli', 'farfalle',
    'macaroni', 'conchiglie', 'orecchiette', 'orzo', 'lasagne', 'lasagna', 'ravioli', 'tortellini', 'cannelloni', 'bucatini',
  ],
  Noodles: ['noodle', 'ramen', 'udon', 'soba', 'vermicelli'],
  Rice: ['rice', 'risotto', 'arborio', 'carnaroli', 'basmati', 'jasmine rice', 'paella rice', 'sushi rice', 'wild rice'],
  Grains: ['couscous', 'quinoa', 'bulgur', 'bulgar', 'freekeh', 'farro', 'spelt', 'barley', 'oat', 'polenta', 'millet', 'buckwheat'],
  Potato: ['potato', 'sweet potato', 'gnocchi', 'mash'],
};

const CARB_NEUTRAL = [
  'breadcrumb', 'bread crumb', 'panko', 'bread flour', 'bread sauce',
  'rice vinegar', 'rice wine', 'rice wine vinegar', 'rice flour', 'rice paper', 'rice bran oil',
  'potato starch', 'potato flour', 'oat milk', 'barley malt', 'spelt flour', 'buckwheat flour',
];

/**
 * Remove neutral phrases from a normalized line.
 * @param {string} text
 * @param {string[]} phrases
 */
function stripPhrases(text, phrases) {
  let t = text;
  for (const p of phrases) t = removeTerm(t, p).text;
  return t;
}

/**
 * Infer Protein values from ingredient lines.
 * No meat or fish anywhere → Vegetarian. Only animal-derived flavourings
 * (fish sauce, chicken stock…) → no value (Uncategorised).
 * @param {string[]} ingredients
 * @returns {string[]}
 */
export function inferProtein(ingredients) {
  const found = new Set();
  let nonVeg = false;
  for (const line of ingredients) {
    let text = stripPhrases(normalizeText(line), PROTEIN_NEUTRAL);
    for (const f of NON_VEG_FLAVOURINGS) {
      const r = removeTerm(text, f);
      if (r.found) nonVeg = true;
      text = r.text;
    }
    for (const [value, terms] of Object.entries(PROTEIN_TERMS)) {
      if (terms.some((t) => containsTerm(text, t))) found.add(value);
    }
  }
  if (found.size) return FACET_VALUES.protein.filter((v) => found.has(v));
  return nonVeg ? [] : ['Vegetarian'];
}

/**
 * Infer Carb values from ingredient lines. Nothing found → None / Other.
 * @param {string[]} ingredients
 * @returns {string[]}
 */
export function inferCarb(ingredients) {
  const found = new Set();
  for (const line of ingredients) {
    let text = normalizeText(line);
    for (const [value, phrases] of Object.entries(CARB_PHRASES)) {
      for (const p of phrases) {
        const r = removeTerm(text, p);
        if (r.found) found.add(value);
        text = r.text;
      }
    }
    text = stripPhrases(text, CARB_NEUTRAL);
    for (const [value, terms] of Object.entries(CARB_TERMS)) {
      if (terms.some((t) => containsTerm(text, t))) found.add(value);
    }
  }
  if (found.size) return FACET_VALUES.carb.filter((v) => found.has(v));
  return ['None / Other'];
}

/**
 * Infer Meal from the recipe name, falling back to keywords and categories.
 * @param {{ name: string, keywords?: string[], categories?: string[] }} recipe
 * @returns {string[]}
 */
export function inferMeal({ name, keywords = [], categories = [] }) {
  // Only the part of the name before "with" / a comma names the dish.
  const head = normalizeText(String(name).split(/,|\bwith\b|\bserved\b/i)[0]);
  let best = null;
  let bestEnd = -1;
  for (const [value, terms] of Object.entries(MEAL_TERMS)) {
    for (const t of terms) {
      const end = lastTermEnd(head, t);
      if (end > bestEnd) {
        bestEnd = end;
        best = value;
      }
    }
  }
  if (best) return [best];

  const found = new Set();
  for (const raw of [...keywords, ...categories]) {
    const text = normalizeText(raw);
    for (const [value, terms] of Object.entries(MEAL_TERMS)) {
      if (terms.some((t) => containsTerm(text, t))) found.add(value);
    }
  }
  return FACET_VALUES.meal.filter((v) => found.has(v));
}

/**
 * @typedef {object} Categories
 * @property {string[]} meal
 * @property {string[]} protein
 * @property {string[]} carb
 * @property {Facet[]} inferred   facets whose values were inferred
 * @property {string[]} warnings  unknown tag values etc.
 */

/**
 * Work out a recipe's Meal/Protein/Carb values. Explicit values (meal from
 * recipeCategory or meal: keywords; protein:/carb: keywords) win per facet;
 * otherwise values are inferred.
 * @param {import('./jsonld.js').Recipe} recipe
 * @returns {Categories}
 */
export function categorize(recipe) {
  /** @type {Categories} */
  const out = { meal: [], protein: [], carb: [], inferred: [], warnings: [] };
  const explicit = { meal: new Set(), protein: new Set(), carb: new Set() };

  for (const raw of recipe.categories ?? []) {
    const v = resolveFacetValue('meal', raw);
    if (v) explicit.meal.add(v);
  }
  for (const facet of FACETS) {
    for (const raw of recipe.facetTags?.[facet] ?? []) {
      const v = resolveFacetValue(facet, raw);
      if (v) explicit[facet].add(v);
      else out.warnings.push(`unknown ${facet} tag "${raw}" (expected one of: ${FACET_VALUES[facet].join(', ')})`);
    }
  }

  const infer = {
    meal: () => inferMeal(recipe),
    protein: () => inferProtein(recipe.ingredients ?? []),
    carb: () => inferCarb(recipe.ingredients ?? []),
  };
  for (const facet of FACETS) {
    if (explicit[facet].size) {
      out[facet] = FACET_VALUES[facet].filter((v) => explicit[facet].has(v));
    } else {
      out[facet] = infer[facet]();
      out.inferred.push(facet);
    }
  }
  return out;
}

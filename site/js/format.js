// Display formatting helpers. Pure functions.

/**
 * 45 → "45 min", 75 → "1 hr 15 min", 180 → "3 hr", 1500 → "1 day 1 hr"
 * @param {number | null | undefined} minutes
 * @returns {string}
 */
export function formatMinutes(minutes) {
  if (minutes == null || !(minutes > 0)) return '';
  const d = Math.floor(minutes / 1440);
  const hr = Math.floor((minutes % 1440) / 60);
  const min = Math.round(minutes % 60);
  const parts = [];
  if (d) parts.push(`${d} day${d > 1 ? 's' : ''}`);
  if (hr) parts.push(`${hr} hr`);
  if (min && !d) parts.push(`${min} min`);
  return parts.join(' ');
}

const NUTRITION_LABELS = {
  servingSize: 'Serving size',
  calories: 'Calories',
  fatContent: 'Fat',
  saturatedFatContent: 'Saturated fat',
  unsaturatedFatContent: 'Unsaturated fat',
  transFatContent: 'Trans fat',
  carbohydrateContent: 'Carbohydrate',
  sugarContent: 'Sugars',
  fiberContent: 'Fibre',
  proteinContent: 'Protein',
  sodiumContent: 'Sodium',
  cholesterolContent: 'Cholesterol',
};

/**
 * schema.org NutritionInformation key → label.
 * "saturatedFatContent" → "Saturated fat"; unknown keys are de-camel-cased.
 * @param {string} key
 */
export function nutritionLabel(key) {
  if (NUTRITION_LABELS[key]) return NUTRITION_LABELS[key];
  const words = key.replace(/Content$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Nutrition entries in a sensible order: known keys first. */
export function nutritionEntries(nutrition) {
  const known = Object.keys(NUTRITION_LABELS);
  return Object.entries(nutrition ?? {}).sort(([a], [b]) => {
    const ia = known.indexOf(a);
    const ib = known.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

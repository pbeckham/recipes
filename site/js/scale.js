// Ingredient quantity parsing and scaling (R10). Pure functions, no DOM.
// Only a quantity at the start of a line is scaled ("2 eggs", "1 1/2 cups",
// "½ tsp", "2-3 cloves", "500g", "1 x 400 g tin"). Anything else — "Juice of
// 1 lemon", "A pinch of salt" — is left exactly as written.

const VULGAR = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅕': 0.2, '⅙': 1 / 6 };
const VULGAR_CHARS = Object.keys(VULGAR).join('');

// One amount: "1 1/2", "1½", "1 ½", "1/2", "½", "1.5", "1,5", "2".
const AMOUNT = `(?:\\d+(?:[.,]\\d+)?\\s*[${VULGAR_CHARS}]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|[${VULGAR_CHARS}])`;
// An amount, optionally a range: "2-3", "2 – 3", "2 to 3".
const LEADING = new RegExp(`^(\\s*)(${AMOUNT})(?:(\\s*(?:-|–|—|to)\\s*)(${AMOUNT}))?`);

/**
 * Parse one amount string to a number.
 * @param {string} s
 * @returns {number | null}
 */
export function parseAmount(s) {
  const t = s.trim();
  let m;
  if ((m = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*([${VULGAR_CHARS}])$`).exec(t))) return Number(m[1].replace(',', '.')) + VULGAR[m[2]];
  if ((m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t))) return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null;
  if ((m = /^(\d+)\/(\d+)$/.exec(t))) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  if (t.length === 1 && t in VULGAR) return VULGAR[t];
  return null;
}

/**
 * @typedef {object} ParsedLine
 * @property {string} lead        whitespace before the quantity
 * @property {number} amount
 * @property {number | null} amountTo   upper end of a range ("2-3")
 * @property {string} sep         range separator as written
 * @property {string} rest        everything after the quantity, unchanged
 * @property {boolean} decimal    the quantity was written with a decimal point
 */

/**
 * Split an ingredient line into its leading quantity and the rest.
 * Returns null when the line doesn't start with a quantity.
 * Years and other big numbers glued to letters are not a concern for
 * ingredient lines; a leading number is always treated as a quantity.
 * @param {string} line
 * @returns {ParsedLine | null}
 */
export function parseLine(line) {
  const m = LEADING.exec(line);
  if (!m) return null;
  const amount = parseAmount(m[2]);
  const amountTo = m[4] ? parseAmount(m[4]) : null;
  if (amount == null || amount <= 0) return null;
  return {
    lead: m[1],
    amount,
    amountTo,
    sep: m[3] ?? '',
    rest: line.slice(m[0].length),
    decimal: /[.,]\d/.test(m[2] + (m[4] ?? '')),
  };
}

const FRACTIONS = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
];

/**
 * Format a scaled amount for a cook:
 * whole numbers stay whole; small amounts use fraction glyphs (1½, ⅓);
 * decimals are kept when the recipe wrote decimals (1.2 litres → 2.4);
 * larger amounts are rounded sensibly (375 g, not 374.99 g).
 * @param {number} n
 * @param {{ decimal?: boolean }} [options]
 */
export function formatAmount(n, { decimal = false } = {}) {
  if (!(n > 0)) return '0';
  const near = (a, b, tol = 0.02) => Math.abs(a - b) < tol;
  if (near(n, Math.round(n), 0.01)) return String(Math.round(n));
  if (decimal) {
    const s = n >= 10 ? n.toFixed(1) : n.toFixed(2);
    return s.replace(/\.?0+$/, '');
  }
  if (n < 10) {
    const whole = Math.floor(n);
    const frac = n - whole;
    for (const [value, glyph] of FRACTIONS) {
      if (near(frac, value, 0.03)) return `${whole || ''}${glyph}`;
    }
    if (near(frac, 1, 0.03)) return String(whole + 1);
    return n.toFixed(1).replace(/\.0$/, '');
  }
  if (n < 100) return String(Math.round(n));
  // Round bigger amounts to a friendly step: 5 below 1000, else 10.
  const step = n < 1000 ? 5 : 10;
  return String(Math.round(n / step) * step);
}

// Units after a quantity. Anything else is treated as a count of items
// ("2 onions", "1 x 400 g tin", "3 eggs").
const UNIT = /^\s*(?:g|grams?|gr|kg|kilos?|kilograms?|mg|ml|millilitres?|milliliters?|cl|dl|l|litres?|liters?|tsp|tsps|teaspoons?|tbsp|tbsps|tbs|tablespoons?|cups?|oz|ounces?|fl\.?\s*oz|lbs?|pounds?|pints?|quarts?|qt|pt|cm|mm|inch(?:es)?|in\b|%)(?![a-z])/i;

/** Does the text after a quantity start with a unit? ("g flour", " tbsp oil") */
export const hasUnit = (rest) => UNIT.test(rest);

/**
 * Round a scaled count of items to something usable in a kitchen:
 * nearest ½ below 2 (never below ½), otherwise a whole number.
 * 1⅓ onions → 1½, 2⅔ carrots → 3, 0.4 eggs → ½.
 * @param {number} n
 */
export function roundCount(n) {
  if (n < 2) return Math.max(0.5, Math.round(n * 2) / 2);
  return Math.round(n);
}

/**
 * @typedef {object} ScaledLine
 * @property {string} before     text before the quantity (usually '')
 * @property {string | null} qty scaled quantity text, or null if the line has none
 * @property {string} after      the rest of the line
 */

/**
 * Scale one ingredient line. Measured amounts (with a unit) keep their
 * precision; counted items are rounded with roundCount(). Lines without a
 * leading quantity come back unchanged with qty = null. The quantity is returned separately so the UI
 * can highlight it.
 * @param {string} line
 * @param {number} factor
 * @returns {ScaledLine}
 */
export function scaleLine(line, factor) {
  const p = parseLine(line);
  if (!p || factor === 1) {
    if (!p) return { before: '', qty: null, after: line };
    const original = line.slice(p.lead.length, line.length - p.rest.length);
    return { before: p.lead, qty: original, after: p.rest };
  }
  const opts = { decimal: p.decimal };
  const count = !hasUnit(p.rest);
  const fmt = (n) => formatAmount(count ? roundCount(n) : n, count ? {} : opts);
  let qty = fmt(p.amount * factor);
  if (p.amountTo != null) qty += `${p.sep}${fmt(p.amountTo * factor)}`;
  // The rest is kept exactly as written, so "500g" stays "750g".
  return { before: p.lead, qty, after: p.rest };
}

/**
 * Servings choices for the stepper: 1…max, where max is generous for
 * batch cooking.
 * @param {number} base
 */
export const maxServings = (base) => Math.max(12, Math.ceil(base * 4));

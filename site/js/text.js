// Text helpers shared by the browser app and tools/.
// Pure functions, no DOM or Node APIs.

/**
 * Lowercase and strip diacritics ("Crème Brûlée" → "creme brulee").
 * @param {unknown} s
 * @returns {string}
 */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Fold, turn "&" into "and", and reduce to space-separated [a-z0-9] tokens.
 * All term matching is done on text in this form.
 * @param {unknown} s
 * @returns {string}
 */
export function normalizeText(s) {
  return fold(s)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build the regex body for a term, tolerating simple plurals on its last word:
 * tomato → tomatoes, prawn → prawns, anchovy → anchovies.
 * @param {string} term
 */
function termSource(term) {
  const words = normalizeText(term).split(' ').filter(Boolean);
  if (!words.length) return null;
  let last = words.pop();
  let lastSrc;
  if (/[^aeiou]y$/.test(last)) {
    lastSrc = `${escapeRe(last.slice(0, -1))}(?:y|ies)`;
  } else {
    lastSrc = `${escapeRe(last)}(?:s|es)?`;
  }
  return [...words.map(escapeRe), lastSrc].join(' ');
}

const cache = new Map();

/**
 * Regex matching a whole-word term inside normalized text.
 * Capture group 1 is the leading boundary so replacements can keep it.
 * @param {string} term
 * @param {string} [flags]
 * @returns {RegExp | null}
 */
export function termRegex(term, flags = '') {
  const key = `${flags}|${term}`;
  if (!cache.has(key)) {
    const src = termSource(term);
    cache.set(key, src ? new RegExp(`(^| )${src}(?= |$)`, flags) : null);
  }
  const re = cache.get(key);
  if (re) re.lastIndex = 0;
  return re;
}

/**
 * Does normalized text contain the term as whole words (plural-tolerant)?
 * @param {string} normText output of normalizeText()
 * @param {string} term
 */
export function containsTerm(normText, term) {
  const re = termRegex(term);
  return re ? re.test(normText) : false;
}

/**
 * Position just after the last occurrence of a term, or -1.
 * @param {string} normText
 * @param {string} term
 */
export function lastTermEnd(normText, term) {
  const re = termRegex(term, 'g');
  if (!re) return -1;
  let end = -1;
  let m;
  while ((m = re.exec(normText))) end = m.index + m[0].length;
  return end;
}

/**
 * Remove every occurrence of a term from normalized text.
 * @param {string} normText
 * @param {string} term
 * @returns {{ text: string, found: boolean }}
 */
export function removeTerm(normText, term) {
  const re = termRegex(term, 'g');
  if (!re) return { text: normText, found: false };
  let found = false;
  const text = normText.replace(re, (_m, lead) => {
    found = true;
    return `${lead} `;
  });
  return { text: text.replace(/ +/g, ' ').trim(), found };
}

/**
 * Naive English singular for ingredient words.
 * @param {string} word
 */
export function singularize(word) {
  if (word.length <= 3) return word;
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|x|z)es$/.test(word)) return word.slice(0, -2);
  if (/oes$/.test(word)) return word.slice(0, -2);
  if (/(?:ss|us|is)$/.test(word)) return word;
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

// Words that never name an ingredient: units, sizes, preparation, filler.
const STOPWORDS = new Set(`
  a about an and any as at approx approximately each for from in into of on or per plus the to with without
  g gram grams kg kilo kilogram kilograms mg ml millilitre millilitres milliliter milliliters l litre litres liter liters
  cl dl tsp tsps teaspoon teaspoons tbsp tbsps tablespoon tablespoons tbs cup cups oz ounce ounces lb lbs pound pounds
  pint pints quart quarts qt pt fl inch inches cm mm
  pinch pinches dash dashes handful handfuls bunch bunches sprig sprigs stick sticks knob slice slices piece pieces
  tin tins can cans jar jars packet packets pack packs bag bags box carton cartons bottle bottles block blocks pot
  large small medium big little mini extra heaped level rounded generous scant good few some several couple
  chopped diced sliced minced grated crushed peeled halved quartered trimmed shredded torn beaten whisked melted
  softened cubed cut finely roughly thinly thickly coarsely freshly lightly well very just
  fresh dried frozen cooked uncooked raw ripe cold warm hot room temperature
  drained rinsed washed deseeded seeded stoned pitted boned boneless skinless skin bone
  optional serve serving servings taste needed required divided plus more extra other leftover
  whole half halves quarter third thirds into about
`.trim().split(/\s+/));

// Describing words: never a term on their own, but they can start a
// two-word term ("red onion", "smoked paprika", "lemon juice" ← head word).
const MODIFIERS = new Set(`
  red green yellow orange white black brown pink golden dark light
  ground smoked toasted roasted flaked crusty plain self raising unsalted salted natural
  sweet sour spring caster icing granulated soft firm double single streaky baby new
  flat leaf curly long short grain wholegrain wholemeal strong instant fast action
  juice zest
`.trim().split(/\s+/));

/**
 * Candidate ingredient terms from one ingredient line, for the suggestion
 * vocabulary. Looks only at the part before the first comma, ignores
 * parentheses, quantities and preparation words, singularizes, and returns
 * single words plus adjacent two-word terms. Describing words (MODIFIERS)
 * only appear as the first word of a two-word term.
 * "2 large garlic cloves, crushed" → ["garlic", "clove", "garlic clove"]
 * "1 red onion" → ["onion", "red onion"]
 * @param {string} line
 * @returns {string[]}
 */
export function ingredientTerms(line) {
  const head = String(line).split(',')[0].replace(/\([^)]*\)/g, ' ');
  const tokens = normalizeText(head).split(' ');
  const out = new Set();
  let prev = null;
  for (const raw of tokens) {
    if (!raw || /\d/.test(raw) || raw.length < 3 || STOPWORDS.has(raw)) {
      prev = null;
      continue;
    }
    const word = singularize(raw);
    if (!MODIFIERS.has(word)) {
      out.add(word);
      if (prev) out.add(`${prev} ${word}`);
    }
    prev = word;
  }
  return [...out];
}

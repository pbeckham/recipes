// schema.org Recipe JSON-LD → normalized recipe object.
// Shared by the browser app and tools/build-index.mjs. Pure functions, no DOM or Node APIs.
// Recipe files are untrusted input: everything returned here is plain text, never HTML.

/**
 * @typedef {{ name: string | null, steps: string[] }} InstructionSection
 *
 * @typedef {object} Recipe
 * @property {string} name
 * @property {string} description
 * @property {string | null} image          First image URL or path, as written in the file
 * @property {string} author
 * @property {string | null} url            Original source (url or isBasedOn)
 * @property {string[]} cuisine
 * @property {string[]} categories          Raw recipeCategory values
 * @property {string[]} keywords            Keywords without facet prefixes
 * @property {{ meal: string[], protein: string[], carb: string[] }} facetTags  Raw values of meal:/protein:/carb: keywords
 * @property {string | null} book           Cookbook it comes from (isPartOf, or a book: keyword)
 * @property {string | null} page           Page in that book (page: keyword)
 * @property {number | null} prepMinutes
 * @property {number | null} cookMinutes
 * @property {number | null} totalMinutes   totalTime, or prep + cook when missing
 * @property {string} yield                 Display text, e.g. "4 servings"
 * @property {number | null} servings       First number in recipeYield, for scaling
 * @property {string[]} ingredients
 * @property {InstructionSection[]} instructions
 * @property {Record<string, string>} nutrition
 */

/** @param {unknown} v @returns {any[]} */
export const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', deg: '°', times: '×',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç',
  iuml: 'ï', ouml: 'ö', uuml: 'ü', auml: 'ä', ntilde: 'ñ', szlig: 'ß',
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Plain text from a JSON-LD value: strips HTML tags, decodes entities,
 * tidies whitespace. Keeps line breaks.
 * @param {unknown} v
 * @returns {string}
 */
export function cleanText(v) {
  if (v == null) return '';
  let s;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number') s = String(v);
  else if (typeof v === 'object' && !Array.isArray(v)) {
    const o = /** @type {any} */ (v);
    s = typeof o['@value'] === 'string' ? o['@value'] : typeof o.text === 'string' ? o.text : typeof o.name === 'string' ? o.name : '';
  } else return '';
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Single-line plain text. @param {unknown} v */
export const oneLine = (v) => cleanText(v).replace(/\n+/g, ' ');

/** Does a node's @type include the given schema.org type? */
export function hasType(node, type) {
  if (!node || typeof node !== 'object') return false;
  return toArray(node['@type']).some((t) => typeof t === 'string' && t.split(/[/:#]/).pop() === type);
}

/**
 * Find the Recipe node in a parsed JSON-LD document: a single object, a
 * top-level array, a @graph container, or nested (e.g. WebPage.mainEntity).
 * @param {unknown} data
 * @returns {Record<string, any> | null}
 */
export function findRecipeNode(data, depth = 0) {
  if (depth > 6 || data == null || typeof data !== 'object') return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (hasType(data, 'Recipe')) return /** @type {any} */ (data);
  for (const [key, value] of Object.entries(data)) {
    if (key === '@context') continue;
    if (value && typeof value === 'object') {
      const found = findRecipeNode(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * ISO 8601 duration ("PT1H30M", "P1DT2H", "PT0.5H") → whole minutes.
 * Also accepts loose text like "1 hour 20 mins". Zero or unparseable → null.
 * @param {unknown} v
 * @returns {number | null}
 */
export function parseDuration(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const iso = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(s);
  let minutes = null;
  if (iso && !/^PT?$/i.test(s)) {
    const [, w = 0, d = 0, h = 0, m = 0, sec = 0] = iso.map((x) => (x === undefined ? 0 : Number(x)));
    minutes = Number(w) * 10080 + Number(d) * 1440 + Number(h) * 60 + Number(m) + Number(sec) / 60;
  } else {
    const h = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(s);
    const m = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/i.exec(s);
    if (h || m) minutes = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  }
  return minutes && minutes > 0 ? Math.round(minutes) : null;
}

/**
 * Comma-separated string(s) or array → trimmed, de-duplicated list.
 * @param {unknown} v
 * @returns {string[]}
 */
export function textList(v) {
  const out = [];
  for (const item of toArray(v)) {
    const parts = typeof item === 'string' ? cleanText(item).split(/[,\n]/) : [oneLine(item)];
    for (const p of parts) {
      const t = p.trim();
      if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  }
  return out;
}

const FACET_PREFIX = /^(meal|protein|carb)\s*:\s*(.+)$/i;
const BOOK_PREFIX = /^book\s*:\s*(.+)$/i;
const PAGE_PREFIX = /^(?:page|p)\s*[:.]\s*(\S.*)$/i;

function splitKeywords(v) {
  const keywords = [];
  const facetTags = { meal: [], protein: [], carb: [] };
  let book = null;
  let page = null;
  for (const k of textList(v)) {
    let m;
    if ((m = FACET_PREFIX.exec(k))) facetTags[m[1].toLowerCase()].push(m[2].trim());
    else if ((m = BOOK_PREFIX.exec(k))) book ??= m[1].trim();
    else if ((m = PAGE_PREFIX.exec(k))) page ??= m[1].trim();
    else keywords.push(k);
  }
  return { keywords, facetTags, book, page };
}

/**
 * The book a recipe comes from: schema.org isPartOf (a Book, or any named
 * work, or a plain string). Falls back to a "book:" keyword, which suits
 * simple names (keywords are split on commas).
 * @param {unknown} isPartOf
 * @param {string | null} keywordBook
 * @returns {string | null}
 */
function parseBook(isPartOf, keywordBook) {
  const parts = toArray(isPartOf);
  const named = (it) => (typeof it === 'string' ? oneLine(it) : it && typeof it === 'object' ? oneLine(it.name) : '');
  const book = parts.find((it) => hasType(it, 'Book') && named(it)) ?? parts.find((it) => named(it) && !/^https?:/i.test(named(it)));
  return (book ? named(book) : '') || keywordBook || null;
}

function firstImage(v) {
  for (const it of toArray(v)) {
    if (typeof it === 'string' && it.trim()) return it.trim();
    if (it && typeof it === 'object') {
      const u = it.url ?? it.contentUrl ?? it['@id'];
      if (typeof u === 'string' && u.trim()) return u.trim();
      if (Array.isArray(u)) return firstImage(u);
    }
  }
  return null;
}

function parseYield(v) {
  const items = toArray(v)
    .map((x) => (typeof x === 'number' ? String(x) : oneLine(x)))
    .filter(Boolean);
  let servings = null;
  for (const it of items) {
    const m = /\d+(?:\.\d+)?/.exec(it);
    if (m) {
      servings = Number(m[0]);
      break;
    }
  }
  const text = items.find((it) => /[a-z]/i.test(it)) ?? (servings ? `${servings} servings` : '');
  return { yield: text, servings: servings && servings > 0 ? servings : null };
}

const STEP_NUMBER = /^\s*(?:step\s*)?\d+\s*[.):-]\s+/i;

function stringSteps(s) {
  return cleanText(s)
    .split('\n')
    .map((line) => line.replace(STEP_NUMBER, '').trim())
    .filter(Boolean);
}

function stepText(it) {
  if (typeof it === 'string') return oneLine(it).replace(STEP_NUMBER, '');
  if (!it || typeof it !== 'object') return '';
  let t = oneLine(it.text ?? it.description ?? '');
  if (!t && it.itemListElement) {
    t = toArray(it.itemListElement).map(stepText).filter(Boolean).join(' ');
  }
  if (!t) t = oneLine(it.name ?? '');
  return t.replace(STEP_NUMBER, '');
}

function isSection(it) {
  return hasType(it, 'HowToSection') || (hasType(it, 'ItemList') && it.itemListElement);
}

/**
 * recipeInstructions in any common shape → sections of plain-text steps.
 * Steps outside any section go into sections with name null.
 * @param {unknown} v
 * @returns {InstructionSection[]}
 */
export function parseInstructions(v) {
  /** @type {InstructionSection[]} */
  const sections = [];
  let loose = null;
  const push = (text) => {
    if (!text) return;
    if (!loose) {
      loose = { name: null, steps: [] };
      sections.push(loose);
    }
    loose.steps.push(text);
  };
  const sectionSteps = (items) =>
    toArray(items).flatMap((sub) =>
      typeof sub === 'string' ? stringSteps(sub) : isSection(sub) ? sectionSteps(sub.itemListElement) : [stepText(sub)],
    );

  for (const it of toArray(v)) {
    if (typeof it === 'string') {
      stringSteps(it).forEach(push);
    } else if (isSection(it)) {
      sections.push({ name: oneLine(it.name) || null, steps: sectionSteps(it.itemListElement).filter(Boolean) });
      loose = null;
    } else {
      push(stepText(it));
    }
  }
  return sections.filter((s) => s.steps.length);
}

function parseIngredients(v) {
  return toArray(v)
    .flatMap((x) => (typeof x === 'string' ? cleanText(x).split('\n') : [oneLine(x)]))
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseNutrition(v) {
  /** @type {Record<string, string>} */
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v)) {
      if (k.startsWith('@')) continue;
      if (typeof val === 'string' || typeof val === 'number') {
        const t = oneLine(val);
        if (t) out[k] = t;
      }
    }
  }
  return out;
}

function parseAuthor(v) {
  return toArray(v)
    .map((a) => (typeof a === 'string' ? oneLine(a) : oneLine(a?.name)))
    .filter(Boolean)
    .join(', ');
}

function sourceUrl(node) {
  for (const v of [node.url, node.isBasedOn]) {
    for (const it of toArray(v)) {
      const u = typeof it === 'string' ? it : it?.url ?? it?.['@id'];
      if (typeof u === 'string' && /^https?:\/\//i.test(u.trim())) return u.trim();
    }
  }
  return null;
}

/**
 * Normalize a Recipe node.
 * @param {Record<string, any>} node
 * @returns {Recipe}
 */
export function normalizeRecipe(node) {
  const prepMinutes = parseDuration(node.prepTime);
  const cookMinutes = parseDuration(node.cookTime);
  let totalMinutes = parseDuration(node.totalTime);
  if (totalMinutes == null && (prepMinutes != null || cookMinutes != null)) {
    totalMinutes = (prepMinutes ?? 0) + (cookMinutes ?? 0);
  }
  const { keywords, facetTags, book: keywordBook, page } = splitKeywords(node.keywords);
  const y = parseYield(node.recipeYield ?? node.yield);
  return {
    name: oneLine(node.name),
    description: cleanText(node.description),
    image: firstImage(node.image),
    author: parseAuthor(node.author),
    url: sourceUrl(node),
    cuisine: textList(node.recipeCuisine),
    categories: textList(node.recipeCategory),
    keywords,
    facetTags,
    book: parseBook(node.isPartOf, keywordBook),
    page,
    prepMinutes,
    cookMinutes,
    totalMinutes,
    yield: y.yield,
    servings: y.servings,
    ingredients: parseIngredients(node.recipeIngredient ?? node.ingredients),
    instructions: parseInstructions(node.recipeInstructions),
    nutrition: parseNutrition(node.nutrition),
  };
}

/**
 * Parsed JSON-LD document → normalized Recipe, or null if it contains none.
 * @param {unknown} data
 * @returns {Recipe | null}
 */
export function extractRecipe(data) {
  const node = findRecipeNode(data);
  return node ? normalizeRecipe(node) : null;
}

/**
 * Resolve a reference found in a recipe file against that file's path.
 * Absolute URLs ("https://…", "data:…") and root paths ("/img/x.jpg") are
 * returned unchanged; relative paths are joined to the file's folder.
 * resolveRelativePath("mains/lasagne.json", "lasagne.jpg") → "mains/lasagne.jpg"
 * @param {string} fromFile path of the recipe file, "/"-separated
 * @param {string} ref
 */
export function resolveRelativePath(fromFile, ref) {
  if (isAbsoluteRef(ref)) return ref;
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of ref.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** @param {string} ref */
export const isAbsoluteRef = (ref) => /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/');

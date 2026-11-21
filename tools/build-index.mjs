#!/usr/bin/env node
// Scan a folder of schema.org Recipe JSON-LD files and write index.json.
// Node >= 20, built-in modules only. Run with --help for usage.

import { readdir, readFile, stat, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { extractRecipe, resolveRelativePath, isAbsoluteRef } from '../site/js/jsonld.js';
import { categorize, FACETS, FACET_LABELS, FACET_VALUES, UNCATEGORISED } from '../site/js/taxonomy.js';
import { ingredientTerms } from '../site/js/text.js';
import { parseCatalog, matchBooks } from '../site/js/books.js';

export const INDEX_VERSION = 1;
const RECIPE_EXT = /\.(jsonld|json)$/i;
const DESCRIPTION_MAX = 280;

const USAGE = `Usage: node tools/build-index.mjs <recipes-dir> [options]

Scans <recipes-dir> (recursively) for *.json / *.jsonld schema.org Recipe
files and writes <recipes-dir>/index.json.

Options:
  --out <file>   Write the index somewhere else
  --books <file> Cookbook contents list (default: <recipes-dir>/books.json, if present)
  --dry-run      Don't write anything
  --if-changed   Only write when the recipes changed (ignores the timestamp),
                 so a timer can run this often without clients re-downloading
  --report       Print facet counts and recipes with inferred/uncategorised facets
  --strict       Exit with status 1 if there are any warnings (for CI)
  -h, --help     Show this help`;

/** @param {string} root @param {string} [rel] @returns {Promise<string[]>} */
async function walk(root, rel = '') {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) files.push(...(await walk(root, relPath)));
    else if (e.isFile()) files.push(relPath);
  }
  return files;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trimEnd()}…`;
}

/**
 * Ingredient terms with the number of recipes using them, most common first.
 * Single words are always kept; two-word terms only if used by 2+ recipes.
 * @param {{ ingredients: string[] }[]} recipes
 * @returns {{ term: string, count: number }[]}
 */
export function buildVocabulary(recipes) {
  const counts = new Map();
  for (const r of recipes) {
    const terms = new Set(r.ingredients.flatMap(ingredientTerms));
    for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts]
    .filter(([term, count]) => !term.includes(' ') || count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term, count]) => ({ term, count }));
}

/**
 * Load a books.json contents list. A missing default file is fine; a missing
 * file that was asked for, or an invalid one, gives warnings.
 * @returns {Promise<import('../site/js/books.js').CatalogBook[]>}
 */
async function loadCatalog(file, required, warn) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    if (required) warn(path.basename(file), `books file not found: ${file}`);
    return [];
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    warn(path.basename(file), `invalid JSON: ${e.message}`);
    return [];
  }
  const { books, warnings } = parseCatalog(data);
  for (const w of warnings) warn(path.basename(file), w);
  return books;
}

/**
 * Build the index for a recipes folder.
 * @param {string} dir
 * @param {{ now?: Date, booksFile?: string }} [options]
 *   booksFile: cookbook contents list; default <dir>/books.json when it exists
 * @returns {Promise<{ index: object, warnings: { file: string, message: string }[] }>}
 */
export async function buildIndex(dir, { now = new Date(), booksFile } = {}) {
  const warnings = [];
  const warn = (file, message) => warnings.push({ file, message });
  const files = (await walk(dir))
    .filter((f) => RECIPE_EXT.test(f) && f !== 'index.json' && f !== 'books.json')
    .sort();
  const catalog = await loadCatalog(booksFile ?? path.join(dir, 'books.json'), booksFile != null, warn);

  const recipes = [];
  const seen = new Map();
  for (const file of files) {
    const abs = path.join(dir, file);
    let data;
    try {
      data = JSON.parse(await readFile(abs, 'utf8'));
    } catch (e) {
      warn(file, `invalid JSON: ${e.message}`);
      continue;
    }
    const recipe = extractRecipe(data);
    if (!recipe) {
      warn(file, 'no schema.org Recipe found');
      continue;
    }
    if (!recipe.name) {
      warn(file, 'recipe has no name');
      continue;
    }
    const id = file.replace(RECIPE_EXT, '');
    if (seen.has(id)) {
      warn(file, `duplicate id "${id}" (also ${seen.get(id)}); skipped`);
      continue;
    }
    seen.set(id, file);

    let image = null;
    if (recipe.image) {
      image = resolveRelativePath(file, recipe.image);
      if (!isAbsoluteRef(recipe.image) && !(await exists(path.join(dir, image)))) {
        warn(file, `image not found: ${image}`);
        image = null;
      }
    }
    if (!recipe.ingredients.length) warn(file, 'recipe has no ingredients');
    if (!recipe.instructions.length) warn(file, 'recipe has no instructions');

    const cat = categorize(recipe);
    for (const w of cat.warnings) warn(file, w);

    const { mtime } = await stat(abs);
    recipes.push({
      id,
      file,
      name: recipe.name,
      description: truncate(recipe.description.replace(/\n+/g, ' '), DESCRIPTION_MAX),
      image,
      meal: cat.meal,
      protein: cat.protein,
      carb: cat.carb,
      book: recipe.book,
      page: recipe.page,
      inferred: cat.inferred,
      cuisine: recipe.cuisine,
      keywords: recipe.keywords,
      totalMinutes: recipe.totalMinutes,
      yield: recipe.yield,
      ingredients: recipe.ingredients,
      added: mtime.toISOString(),
    });
  }
  recipes.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  // Which book each recipe is from (named in its file, or matched by title
  // against the contents list), and progress per book.
  const { assigned, books } = matchBooks(recipes, catalog);
  for (const r of recipes) {
    const a = assigned.get(r.id);
    r.book = a?.book ?? null;
    r.page = a?.page ?? r.page;
    if (a?.inferred) r.inferred = [...r.inferred, 'book'];
  }

  return {
    index: {
      version: INDEX_VERSION,
      generated: now.toISOString(),
      recipes,
      books,
      ingredientVocabulary: buildVocabulary(recipes),
    },
    warnings,
  };
}

/** Human-readable report of facet coverage and inferred values. */
export function formatReport(index, skipped) {
  const lines = [`Recipes: ${index.recipes.length} indexed, ${skipped} skipped`, ''];
  for (const facet of FACETS) {
    const counts = new Map([...FACET_VALUES[facet], UNCATEGORISED].map((v) => [v, 0]));
    for (const r of index.recipes) {
      for (const v of r[facet].length ? r[facet] : [UNCATEGORISED]) counts.set(v, counts.get(v) + 1);
    }
    const parts = [...counts].filter(([v, n]) => n || v !== UNCATEGORISED).map(([v, n]) => `${v} ${n}`);
    lines.push(`${FACET_LABELS[facet].padEnd(8)} ${parts.join(' · ')}`);
  }
  const noTime = index.recipes.filter((r) => r.totalMinutes == null);
  lines.push(`Time     ${noTime.length} without a known total time${noTime.length ? `: ${noTime.map((r) => r.id).join(', ')}` : ''}`);

  if (index.books?.length) {
    lines.push('', 'Books');
    for (const b of index.books) {
      const progress = b.total != null ? `${b.covered} of ${b.total} from the contents list (${b.total ? Math.round((100 * b.covered) / b.total) : 0}%)` : 'no contents list';
      lines.push(`  ${b.name}: ${b.have} ${b.have === 1 ? 'recipe' : 'recipes'} · ${progress}`);
    }
    const noBook = index.recipes.filter((r) => !r.book).length;
    if (noBook) lines.push(`  (no book: ${noBook})`);
  }

  const flagged = index.recipes.filter((r) => FACETS.some((f) => r.inferred.includes(f) || !r[f].length));
  lines.push('', `Inferred or uncategorised facets (${flagged.length}) — add meal:/protein:/carb: keywords to fix:`);
  if (!flagged.length) lines.push('  (none)');
  for (const r of flagged) {
    const parts = FACETS.filter((f) => r.inferred.includes(f) || !r[f].length).map((f) => {
      const value = r[f].length ? r[f].join(', ') : UNCATEGORISED;
      return `${f}: ${value}${r.inferred.includes(f) ? ' (inferred)' : ''}`;
    });
    lines.push(`  ${r.id}`, `      ${parts.join('; ')}`);
  }
  return lines.join('\n');
}

/** Parsed existing index, or null. */
async function readExisting(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Same content apart from the generation timestamp?
 * @param {any} a @param {any} b
 */
export function sameIndex(a, b) {
  if (!a || !b) return false;
  const strip = ({ generated, ...rest }) => JSON.stringify(rest);
  return strip(a) === strip(b);
}

/**
 * Write via a temporary file and rename, so readers (nginx, possibly over
 * SMB) never see a half-written index.
 * @param {string} file
 * @param {string} content
 */
export async function writeAtomic(file, content) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    await writeFile(tmp, content);
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

async function main(argv) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        books: { type: 'string' },
        'dry-run': { type: 'boolean' },
        'if-changed': { type: 'boolean' },
        report: { type: 'boolean' },
        strict: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = args;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  const dir = path.resolve(positionals[0]);
  if (!(await exists(dir))) {
    console.error(`Recipes folder not found: ${dir}`);
    return 2;
  }

  const { index, warnings } = await buildIndex(dir, { booksFile: values.books ? path.resolve(values.books) : undefined });
  for (const w of warnings) console.warn(`warning: ${w.file}: ${w.message}`);
  const skipped = new Set(warnings.filter((w) => !index.recipes.some((r) => r.file === w.file)).map((w) => w.file)).size;

  if (!values['dry-run']) {
    const out = values.out ? path.resolve(values.out) : path.join(dir, 'index.json');
    if (values['if-changed'] && sameIndex(await readExisting(out), index)) {
      console.log(`Unchanged: ${out} (${index.recipes.length} recipes, ${warnings.length} warnings)`);
    } else {
      await writeAtomic(out, `${JSON.stringify(index)}\n`);
      console.log(`Wrote ${out} (${index.recipes.length} recipes, ${warnings.length} warnings)`);
    }
  } else {
    console.log(`Dry run: ${index.recipes.length} recipes, ${warnings.length} warnings`);
  }
  if (values.report) console.log(`\n${formatReport(index, skipped)}`);
  return values.strict && warnings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

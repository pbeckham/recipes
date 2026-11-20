#!/usr/bin/env node
// Scan a folder of schema.org Recipe JSON-LD files and write index.json.
// Node >= 20, built-in modules only. Run with --help for usage.

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { extractRecipe, resolveRelativePath, isAbsoluteRef } from '../site/js/jsonld.js';
import { categorize, FACETS, FACET_LABELS, FACET_VALUES, UNCATEGORISED } from '../site/js/taxonomy.js';
import { ingredientTerms } from '../site/js/text.js';

export const INDEX_VERSION = 1;
const RECIPE_EXT = /\.(jsonld|json)$/i;
const DESCRIPTION_MAX = 280;

const USAGE = `Usage: node tools/build-index.mjs <recipes-dir> [options]

Scans <recipes-dir> (recursively) for *.json / *.jsonld schema.org Recipe
files and writes <recipes-dir>/index.json.

Options:
  --out <file>   Write the index somewhere else
  --dry-run      Don't write anything
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
 * Build the index for a recipes folder.
 * @param {string} dir
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ index: object, warnings: { file: string, message: string }[] }>}
 */
export async function buildIndex(dir, { now = new Date() } = {}) {
  const warnings = [];
  const warn = (file, message) => warnings.push({ file, message });
  const files = (await walk(dir))
    .filter((f) => RECIPE_EXT.test(f) && f !== 'index.json')
    .sort();

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

  return {
    index: {
      version: INDEX_VERSION,
      generated: now.toISOString(),
      recipes,
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

  const flagged = index.recipes.filter((r) => r.inferred.length || FACETS.some((f) => !r[f].length));
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

async function main(argv) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        'dry-run': { type: 'boolean' },
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

  const { index, warnings } = await buildIndex(dir);
  for (const w of warnings) console.warn(`warning: ${w.file}: ${w.message}`);
  const skipped = new Set(warnings.filter((w) => !index.recipes.some((r) => r.file === w.file)).map((w) => w.file)).size;

  if (!values['dry-run']) {
    const out = values.out ? path.resolve(values.out) : path.join(dir, 'index.json');
    await writeFile(out, `${JSON.stringify(index)}\n`);
    console.log(`Wrote ${out} (${index.recipes.length} recipes, ${warnings.length} warnings)`);
  } else {
    console.log(`Dry run: ${index.recipes.length} recipes, ${warnings.length} warnings`);
  }
  if (values.report) console.log(`\n${formatReport(index, skipped)}`);
  return values.strict && warnings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

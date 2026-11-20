// Loading the index and recipe files. All URLs are relative to the page so
// the app works at any base path (N3).

import { extractRecipe, resolveRelativePath, isAbsoluteRef } from './jsonld.js';

export const RECIPES_DIR = 'recipes/';

export class LoadError extends Error {
  /** @param {string} message @param {'missing' | 'invalid' | 'network'} kind */
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

/** Encode each path segment but keep the slashes. */
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

/**
 * URL for a path inside the recipes folder, or an absolute image URL.
 * Only http(s) and root-relative absolute references are allowed through.
 * @param {string | null | undefined} ref path relative to the recipes folder, or absolute URL
 * @returns {string | null}
 */
export function recipesUrl(ref) {
  if (!ref) return null;
  if (isAbsoluteRef(ref)) return /^(https?:\/\/|\/)/i.test(ref) ? ref : null;
  return RECIPES_DIR + encodePath(ref);
}

async function fetchJson(url, what) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch {
    throw new LoadError(`Couldn't reach the server to load ${what}.`, 'network');
  }
  if (res.status === 404) throw new LoadError(`${what} not found.`, 'missing');
  if (!res.ok) throw new LoadError(`Loading ${what} failed (HTTP ${res.status}).`, 'network');
  try {
    return await res.json();
  } catch {
    throw new LoadError(`${what} isn't valid JSON.`, 'invalid');
  }
}

/** @type {Promise<any> | null} */
let indexPromise = null;

/**
 * The recipe index (loaded once per page load).
 * @returns {Promise<{ version: number, generated: string, recipes: any[], ingredientVocabulary: any[] }>}
 */
export function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetchJson(`${RECIPES_DIR}index.json`, 'The recipe index').then((index) => {
      if (!index || !Array.isArray(index.recipes)) throw new LoadError("The recipe index isn't in the expected format.", 'invalid');
      return index;
    });
    indexPromise.catch(() => {
      indexPromise = null; // allow a retry
    });
  }
  return indexPromise;
}

/**
 * Load and normalize one recipe file. The image path is resolved relative
 * to the recipes folder.
 * @param {{ file: string, name: string }} entry index entry
 */
export async function loadRecipe(entry) {
  const data = await fetchJson(RECIPES_DIR + encodePath(entry.file), `The recipe file "${entry.file}"`);
  const recipe = extractRecipe(data);
  if (!recipe) throw new LoadError(`"${entry.file}" doesn't contain a recipe.`, 'invalid');
  if (recipe.image) recipe.image = resolveRelativePath(entry.file, recipe.image);
  return recipe;
}

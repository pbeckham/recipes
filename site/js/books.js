// Cookbooks: which book each recipe comes from, and how much of each book
// is in the collection. Pure functions, used by tools/build-index.mjs.
//
// A recipe names its book in its own file (isPartOf / "book:" keyword, see
// jsonld.js). Optionally, books.json in the recipes folder lists each book's
// contents:
//
//   { "books": [
//       { "name": "Jamie's America", "author": "Jamie Oliver",
//         "recipes": [ { "title": "Sloppy Joes", "page": 112 }, "Gumbo", … ] } ] }
//
// With a contents list, recipes that don't name a book are matched to one by
// title, and each book shows how many of its recipes are in the collection.

import { normalizeText } from './text.js';

/**
 * Key for comparing recipe titles: case, accents, "&"/"and", a leading
 * article and anything in brackets don't matter.
 * "The Best Mac & Cheese (serves 4)" → "best mac and cheese"
 * @param {string} title
 */
export function titleKey(title) {
  return normalizeText(String(title ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')).replace(/^(the|a|an) /, '');
}

/** Key for comparing book names. */
export const bookKey = (name) => normalizeText(name);

const pageString = (p) => (p == null || p === '' ? null : String(p).trim() || null);

/**
 * @typedef {{ title: string, page: string | null }} CatalogEntry
 * @typedef {{ name: string, author: string | null, recipes: CatalogEntry[] }} CatalogBook
 */

/**
 * Validate a parsed books.json. Bad parts are skipped with a warning.
 * @param {unknown} data
 * @returns {{ books: CatalogBook[], warnings: string[] }}
 */
export function parseCatalog(data) {
  const warnings = [];
  const books = [];
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? /** @type {any} */ (data).books : null;
  if (!Array.isArray(list)) return { books, warnings: ['expected { "books": [ … ] }'] };
  const seen = new Set();
  list.forEach((b, i) => {
    const name = typeof b?.name === 'string' ? b.name.trim() : '';
    if (!name) return warnings.push(`book #${i + 1} has no name; skipped`);
    if (seen.has(bookKey(name))) return warnings.push(`book "${name}" is listed twice; the second is skipped`);
    seen.add(bookKey(name));
    const recipes = [];
    for (const [j, r] of (Array.isArray(b.recipes) ? b.recipes : []).entries()) {
      const title = typeof r === 'string' ? r.trim() : typeof r?.title === 'string' ? r.title.trim() : '';
      if (!title) {
        warnings.push(`"${name}": recipe #${j + 1} has no title; skipped`);
        continue;
      }
      recipes.push({ title, page: typeof r === 'object' ? pageString(r.page) : null });
    }
    books.push({ name, author: typeof b.author === 'string' && b.author.trim() ? b.author.trim() : null, recipes });
  });
  return { books, warnings };
}

/**
 * @typedef {object} BookSummary
 * @property {string} name
 * @property {string | null} author
 * @property {number | null} total      recipes in the contents list (null without one)
 * @property {number} have              recipes in the collection from this book
 * @property {number} covered           contents entries that have a recipe
 * @property {CatalogEntry[]} missing   contents entries without a recipe, in book order
 */

/**
 * Decide each recipe's book and page, and summarise every book.
 * @param {{ id: string, name: string, book: string | null, page: string | null }[]} recipes
 * @param {CatalogBook[]} catalog
 * @returns {{ assigned: Map<string, { book: string, page: string | null, inferred: boolean }>, books: BookSummary[] }}
 */
export function matchBooks(recipes, catalog) {
  const byKey = new Map(catalog.map((b) => [bookKey(b.name), b]));
  // Title → catalog books containing it (to match recipes that name no book).
  const titleIndex = new Map();
  for (const b of catalog) {
    for (const e of b.recipes) {
      const k = titleKey(e.title);
      if (!titleIndex.has(k)) titleIndex.set(k, new Map());
      const perBook = titleIndex.get(k);
      if (!perBook.has(b.name)) perBook.set(b.name, []);
      perBook.get(b.name).push(e);
    }
  }

  const assigned = new Map();
  for (const r of recipes) {
    if (r.book) {
      const name = byKey.get(bookKey(r.book))?.name ?? r.book;
      assigned.set(r.id, { book: name, page: r.page, inferred: false });
      continue;
    }
    const hits = titleIndex.get(titleKey(r.name));
    if (hits && hits.size === 1) {
      const [[name, entries]] = [...hits];
      assigned.set(r.id, { book: name, page: r.page ?? (entries.length === 1 ? entries[0].page : null), inferred: true });
    }
  }

  // Group recipes by book and tick off contents entries.
  const groups = new Map();
  for (const r of recipes) {
    const a = assigned.get(r.id);
    if (!a) continue;
    if (!groups.has(a.book)) groups.set(a.book, []);
    groups.get(a.book).push({ r, a });
  }

  const summaries = [];
  const names = new Set([...catalog.map((b) => b.name), ...groups.keys()]);
  for (const name of names) {
    const book = byKey.get(bookKey(name));
    const members = groups.get(name) ?? [];
    let covered = 0;
    let missing = [];
    if (book) {
      const done = new Set();
      const leftovers = [];
      for (const m of members) {
        const k = titleKey(m.r.name);
        const i = book.recipes.findIndex((e, idx) => !done.has(idx) && titleKey(e.title) === k);
        if (i >= 0) {
          done.add(i);
          if (!m.a.page) m.a.page = book.recipes[i].page;
        } else leftovers.push(m);
      }
      // Second pass: page numbers, when exactly one open entry is on that page.
      for (const m of leftovers) {
        if (!m.a.page) continue;
        const open = book.recipes.map((e, idx) => [e, idx]).filter(([e, idx]) => !done.has(idx) && e.page === m.a.page);
        if (open.length === 1) done.add(open[0][1]);
      }
      covered = done.size;
      missing = book.recipes.filter((_, idx) => !done.has(idx));
    }
    summaries.push({
      name,
      author: book?.author ?? null,
      total: book ? book.recipes.length : null,
      have: members.length,
      covered,
      missing,
    });
  }
  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return { assigned, books: summaries };
}

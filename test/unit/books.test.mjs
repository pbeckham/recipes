import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleKey, parseCatalog, matchBooks } from '../../site/js/books.js';

test('titleKey ignores case, accents, &/and, leading article and brackets', () => {
  assert.equal(titleKey('The Best Mac & Cheese (serves 4)'), 'best mac and cheese');
  assert.equal(titleKey('Crème Brûlée'), 'creme brulee');
  assert.equal(titleKey('A Simple Salad [v]'), 'simple salad');
});

test('parseCatalog: strings or objects, pages as strings, bad parts skipped with warnings', () => {
  const { books, warnings } = parseCatalog({
    books: [
      { name: 'Book A', author: 'Someone', recipes: ['Soup', { title: 'Stew', page: 12 }, { page: 3 }] },
      { recipes: [] },
      { name: 'book a', recipes: [] },
      { name: 'Book B' },
    ],
  });
  assert.deepEqual(books, [
    { name: 'Book A', author: 'Someone', recipes: [{ title: 'Soup', page: null }, { title: 'Stew', page: '12' }] },
    { name: 'Book B', author: null, recipes: [] },
  ]);
  assert.equal(warnings.length, 3);
  assert.deepEqual(parseCatalog('nope').books, []);
  assert.equal(parseCatalog({}).warnings.length, 1);
});

const catalog = parseCatalog({
  books: [
    { name: "Jamie's America", recipes: [{ title: 'Sloppy Joes', page: 112 }, { title: 'Gumbo', page: 40 }, { title: 'Pancakes', page: 10 }] },
    { name: 'River Cottage Veg', recipes: [{ title: 'Pancakes', page: 20 }, { title: 'Leek Gratin', page: 58 }, { title: 'Beetroot Soup', page: 60 }] },
  ],
}).books;

const r = (id, name, book = null, page = null) => ({ id, name, book, page });

test('explicit books win and are matched to the catalog spelling', () => {
  const { assigned } = matchBooks([r('a', 'Sloppy Joes', "JAMIE'S AMERICA")], catalog);
  assert.deepEqual(assigned.get('a'), { book: "Jamie's America", page: '112', inferred: false });
});

test('recipes without a book are matched by a unique title', () => {
  const { assigned } = matchBooks([r('a', 'The Gumbo'), r('b', 'Leek gratin'), r('c', 'Pancakes'), r('d', 'Toast')], catalog);
  assert.deepEqual(assigned.get('a'), { book: "Jamie's America", page: '40', inferred: true });
  assert.deepEqual(assigned.get('b'), { book: 'River Cottage Veg', page: '58', inferred: true });
  assert.equal(assigned.has('c'), false, 'title in two books: not guessed');
  assert.equal(assigned.has('d'), false);
});

test('progress per book: covered by title, then by page; missing in book order', () => {
  const { books } = matchBooks(
    [
      r('a', 'Sloppy Joes', "Jamie's America"),
      r('b', 'American Pancakes', "Jamie's America", '10'), // title differs, page matches
      r('c', 'Leek Gratin'),
      r('d', 'Something Else', 'River Cottage Veg', '999'), // in the book but not in the contents
    ],
    catalog,
  );
  const jamie = books.find((b) => b.name === "Jamie's America");
  assert.deepEqual({ total: jamie.total, have: jamie.have, covered: jamie.covered }, { total: 3, have: 2, covered: 2 });
  assert.deepEqual(jamie.missing, [{ title: 'Gumbo', page: '40' }]);
  const veg = books.find((b) => b.name === 'River Cottage Veg');
  assert.deepEqual({ total: veg.total, have: veg.have, covered: veg.covered }, { total: 3, have: 2, covered: 1 });
  assert.deepEqual(veg.missing.map((e) => e.title), ['Pancakes', 'Beetroot Soup']);
});

test('books named only by recipes (no contents list) are summarised too', () => {
  const { books } = matchBooks([r('a', 'Soup', 'My Notebook'), r('b', 'Stew', 'my notebook')], []);
  assert.equal(books.length, 2, 'without a catalog, spellings are kept as written');
  const { books: one } = matchBooks([r('a', 'Soup', 'My Notebook'), r('b', 'Stew', 'My Notebook')], []);
  assert.deepEqual(one, [{ name: 'My Notebook', author: null, total: null, have: 2, covered: 0, missing: [] }]);
});

test('a contents entry is only covered once', () => {
  const { books } = matchBooks([r('a', 'Gumbo', "Jamie's America"), r('b', 'Gumbo', "Jamie's America")], catalog);
  const jamie = books.find((b) => b.name === "Jamie's America");
  assert.equal(jamie.covered, 1);
  assert.equal(jamie.have, 2);
});

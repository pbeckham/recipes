// Books page: each cookbook, how much of it is in the collection, and which
// of its recipes are still missing (from books.json contents lists).

import { h, icon } from '../dom.js';
import { messageView } from './common.js';

const bookHref = (name) => `#/?${new URLSearchParams({ book: name })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** @param {import('../books.js').BookSummary} b */
function bookCard(b) {
  const id = `book-${b.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const pct = b.total ? Math.round((100 * b.covered) / b.total) : 0;
  const notInList = b.total != null ? b.have - b.covered : 0;
  return h(
    'li',
    { class: 'book-card' },
    h(
      'div',
      { class: 'book-head' },
      h('div', null, h('h2', { id }, b.name), b.author ? h('p', { class: 'muted small' }, b.author) : null),
      b.have ? h('a', { class: 'button button-secondary', href: bookHref(b.name), 'aria-describedby': id }, 'Show recipes') : null,
    ),
    b.total != null
      ? [
          h('p', { class: 'book-progress-text' }, h('strong', null, `${b.covered} of ${b.total}`), ` recipes in the collection · ${pct}%`),
          h('progress', { class: 'book-progress', max: String(b.total || 1), value: String(b.covered), 'aria-labelledby': id }),
        ]
      : h('p', { class: 'book-progress-text' }, h('strong', null, plural(b.have, 'recipe')), h('span', { class: 'muted' }, ' · no contents list')),
    notInList > 0
      ? h('p', { class: 'muted small' }, `${plural(notInList, 'recipe')} from this book ${notInList === 1 ? "doesn't" : "don't"} match the contents list; check the title or page.`)
      : null,
    b.missing.length
      ? h(
          'details',
          { class: 'book-missing' },
          h('summary', null, `${b.missing.length} still to add`),
          h(
            'ol',
            { class: 'missing-list', role: 'list' },
            b.missing.map((e) => h('li', null, e.page ? h('span', { class: 'missing-page' }, `p. ${e.page}`) : null, h('span', null, e.title))),
          ),
        )
      : b.total
        ? h('p', { class: 'book-done' }, 'Complete')
        : null,
  );
}

/**
 * @param {{ recipes: any[], books?: import('../books.js').BookSummary[] }} index
 */
export function renderBooks(index) {
  const books = index.books ?? [];
  if (!books.length) {
    return messageView({
      title: 'No books yet',
      body: [
        'Recipes can say which cookbook they come from. Add this to a recipe file:',
        h('pre', null, h('code', null, '"isPartOf": { "@type": "Book", "name": "Book title" },\n"keywords": "page:112, …"')),
        'To track how much of a book you have, add a books.json contents list to the recipes folder (see the README).',
      ],
      action: h('a', { class: 'button', href: '#/' }, 'All recipes'),
    });
  }
  const noBook = index.recipes.filter((r) => !r.book).length;
  return h(
    'main',
    { id: 'main', class: 'books' },
    h('div', { class: 'page-head' }, h('h1', { tabindex: '-1' }, 'Books'), h('p', { class: 'page-count' }, plural(books.length, 'book'))),
    h('ul', { class: 'book-list', role: 'list' }, books.map(bookCard)),
    noBook ? h('p', { class: 'muted small books-foot' }, `${plural(noBook, 'recipe')} not linked to a book.`) : null,
  );
}

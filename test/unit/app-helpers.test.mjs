import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { formatMinutes, nutritionLabel, nutritionEntries } from '../../site/js/format.js';
import { recipesUrl } from '../../site/js/data.js';
import { startServer } from '../../tools/dev-server.mjs';

test('formatMinutes', () => {
  assert.equal(formatMinutes(45), '45 min');
  assert.equal(formatMinutes(60), '1 hr');
  assert.equal(formatMinutes(75), '1 hr 15 min');
  assert.equal(formatMinutes(200), '3 hr 20 min');
  assert.equal(formatMinutes(490), '8 hr 10 min');
  assert.equal(formatMinutes(1500), '1 day 1 hr');
  assert.equal(formatMinutes(2880), '2 days');
  assert.equal(formatMinutes(null), '');
  assert.equal(formatMinutes(0), '');
});

test('nutrition labels and order', () => {
  assert.equal(nutritionLabel('saturatedFatContent'), 'Saturated fat');
  assert.equal(nutritionLabel('fiberContent'), 'Fibre');
  assert.equal(nutritionLabel('vitaminCContent'), 'Vitamin c');
  assert.deepEqual(
    nutritionEntries({ proteinContent: '1 g', zinc: 'x', calories: '100 kcal' }).map(([k]) => k),
    ['calories', 'proteinContent', 'zinc'],
  );
});

test('recipesUrl: relative paths are encoded under recipes/, unsafe schemes dropped', () => {
  assert.equal(recipesUrl('mains/lasagne.jpg'), 'recipes/mains/lasagne.jpg');
  assert.equal(recipesUrl('My Recipes/crème brûlée.jpg'), 'recipes/My%20Recipes/cr%C3%A8me%20br%C3%BBl%C3%A9e.jpg');
  assert.equal(recipesUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(recipesUrl('/images/a.jpg'), '/images/a.jpg');
  assert.equal(recipesUrl('javascript:alert(1)'), null);
  assert.equal(recipesUrl('data:text/html,hi'), null);
  assert.equal(recipesUrl(null), null);
});

const server = await startServer({ port: 0, base: '/recipes/', quiet: true });
const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
after(() => server.close());

/** Raw GET that doesn't normalize the path, like a hostile client. */
function get(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], location: res.headers.location, body }));
      })
      .on('error', reject);
  });
}

test('dev server: serves the app, recipes and a fresh index under the base path', async () => {
  assert.equal((await get('/recipes')).status, 301);
  assert.equal((await get('/recipes')).location, '/recipes/');
  const home = await get('/recipes/');
  assert.equal(home.status, 200);
  assert.match(home.type, /text\/html/);
  assert.match((await get('/recipes/js/app.js')).type, /javascript/);
  const index = await get('/recipes/recipes/index.json');
  assert.equal(index.status, 200);
  assert.equal(JSON.parse(index.body).recipes.length, 19);
  assert.match((await get('/recipes/recipes/drinks/ginger-lemonade.jsonld')).type, /ld\+json/);
});

test('dev server: refuses paths outside its folders', async () => {
  for (const p of [
    '/recipes/../package.json',
    '/recipes/%2e%2e/package.json',
    '/recipes/recipes/%2e%2e/%2e%2e/package.json',
    '/recipes/recipes/..%2f..%2fpackage.json',
    '/recipes/%2e%2e%2f%2e%2e%2fpackage.json',
    '/recipes/.git/config',
    '/package.json',
  ]) {
    assert.equal((await get(p)).status, 404, p);
  }
  assert.equal((await get('/recipes/%00')).status, 400);
});

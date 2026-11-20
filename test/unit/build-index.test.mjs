import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildIndex, buildVocabulary, formatReport, sameIndex, writeAtomic } from '../../tools/build-index.mjs';
import { mkdtemp, cp, readFile, readdir, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import { FACETS, FACET_VALUES } from '../../site/js/taxonomy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = path.join(root, 'test/fixtures/index-dir');
const samples = path.join(root, 'samples/recipes');
const cli = path.join(root, 'tools/build-index.mjs');

test('fixtures: indexes valid files and warns about bad ones', async () => {
  const { index, warnings } = await buildIndex(fixtures, { now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(index.version, 1);
  assert.equal(index.generated, '2026-01-01T00:00:00.000Z');

  const ids = index.recipes.map((r) => r.id).sort();
  assert.deepEqual(ids, ['a', 'bare', 'dup', 'missing-image', 'remote-image', 'sub/b', 'unknown-tag']);

  const byFile = Object.fromEntries(warnings.map((w) => [w.file, w.message]));
  assert.match(byFile['broken.json'], /invalid JSON/);
  assert.match(byFile['not-recipe.json'], /no schema.org Recipe/);
  assert.match(byFile['no-name.json'], /no name/);
  assert.match(byFile['dup.jsonld'], /duplicate id "dup"/);
  assert.match(byFile['missing-image.json'], /image not found: nope.jpg/);
  assert.match(byFile['unknown-tag.json'], /unknown protein tag "Unicorn"/);
  assert.ok(warnings.some((w) => w.file === 'bare.json' && /no ingredients/.test(w.message)));
  assert.ok(warnings.some((w) => w.file === 'bare.json' && /no instructions/.test(w.message)));
  assert.ok(!warnings.some((w) => w.file === 'index.json'), 'root index.json is ignored');
  assert.ok(!warnings.some((w) => w.file.startsWith('.hidden')), 'dot folders are ignored');
});

test('fixtures: image paths resolve relative to the recipes folder', async () => {
  const { index } = await buildIndex(fixtures);
  const get = (id) => index.recipes.find((r) => r.id === id);
  assert.equal(get('a').image, 'photo.svg');
  assert.equal(get('sub/b').image, 'photo.svg');
  assert.equal(get('missing-image').image, null);
  assert.equal(get('remote-image').image, 'https://example.com/x.jpg');
});

test('index entries have the documented shape', async () => {
  const { index } = await buildIndex(fixtures);
  const keys = ['id', 'file', 'name', 'description', 'image', 'meal', 'protein', 'carb', 'inferred', 'cuisine', 'keywords', 'totalMinutes', 'yield', 'ingredients', 'added'];
  for (const r of index.recipes) assert.deepEqual(Object.keys(r), keys);
  assert.ok(Array.isArray(index.ingredientVocabulary));
});

test('buildVocabulary counts recipes per term; bigrams need 2+ recipes', () => {
  const vocab = buildVocabulary([
    { ingredients: ['2 garlic cloves', '1 garlic clove'] },
    { ingredients: ['3 garlic cloves, crushed', '1 lemon'] },
    { ingredients: ['olive oil'] },
  ]);
  const map = Object.fromEntries(vocab.map((v) => [v.term, v.count]));
  assert.equal(map.garlic, 2);
  assert.equal(map['garlic clove'], 2);
  assert.equal(map.lemon, 1);
  assert.equal(map['olive oil'], undefined);
  assert.equal(map.olive, 1);
  assert.equal(vocab[0].term, 'clove');
});

test('samples: index cleanly with no warnings', async () => {
  const { index, warnings } = await buildIndex(samples);
  assert.deepEqual(warnings, []);
  assert.ok(index.recipes.length >= 15 && index.recipes.length <= 20, `${index.recipes.length} samples`);
});

test('samples: cover every facet value', async () => {
  const { index } = await buildIndex(samples);
  for (const facet of FACETS) {
    const seen = new Set(index.recipes.flatMap((r) => r[facet]));
    for (const v of FACET_VALUES[facet]) assert.ok(seen.has(v), `no sample with ${facet} "${v}"`);
  }
  assert.ok(index.recipes.some((r) => FACETS.some((f) => r[f].length > 1)), 'some sample has several values in a facet');
});

test('samples: exercise inference and the time filter presets', async () => {
  const { index } = await buildIndex(samples);
  assert.ok(index.recipes.filter((r) => r.inferred.length).length >= 2, 'at least 2 untagged samples');
  const times = index.recipes.map((r) => r.totalMinutes);
  assert.ok(times.includes(null), 'one sample without a time');
  const buckets = [15, 30, 45, 60, 90, Infinity];
  buckets.forEach((max, i) => {
    const min = i ? buckets[i - 1] : 0;
    assert.ok(times.some((t) => t != null && t > min && t <= max), `no sample between ${min} and ${max} minutes`);
  });
});

test('formatReport lists inferred recipes', async () => {
  const { index } = await buildIndex(samples);
  const report = formatReport(index, 0);
  assert.match(report, /sauces\/basil-pesto/);
  assert.match(report, /\(inferred\)/);
});

test('CLI: --help, --strict, usage errors', () => {
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.equal(run('--help').status, 0);
  assert.equal(run().status, 2);
  assert.equal(run('does-not-exist').status, 2);
  const strict = run(fixtures, '--dry-run', '--strict');
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /warning: broken.json/);
  const ok = run(samples, '--dry-run', '--strict', '--report');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Inferred or uncategorised/);
});

test('sameIndex ignores only the timestamp', () => {
  const a = { version: 1, generated: '2026-01-01', recipes: [{ id: 'x' }] };
  assert.ok(sameIndex(a, { ...a, generated: '2027-01-01' }));
  assert.ok(!sameIndex(a, { ...a, recipes: [] }));
  assert.ok(!sameIndex(null, a));
});

test('writeAtomic replaces the file and leaves no temp files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idx-'));
  const file = path.join(dir, 'index.json');
  await writeAtomic(file, 'one');
  await writeAtomic(file, 'two');
  assert.equal(await readFile(file, 'utf8'), 'two');
  assert.deepEqual(await readdir(dir), ['index.json']);
  await rm(dir, { recursive: true });
});

test('CLI --if-changed only rewrites when recipes change', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'recipes-'));
  await cp(samples, dir, { recursive: true });
  await rm(path.join(dir, 'index.json'), { force: true });
  const run = () => spawnSync(process.execPath, [cli, dir, '--if-changed'], { encoding: 'utf8' });

  assert.match(run().stdout, /^Wrote /);
  const first = await stat(path.join(dir, 'index.json'));
  assert.match(run().stdout, /^Unchanged: /);
  assert.equal((await stat(path.join(dir, 'index.json'))).mtimeMs, first.mtimeMs);

  await rm(path.join(dir, 'sauces/basil-pesto.json'));
  assert.match(run().stdout, /^Wrote .*\(18 recipes/);
  await rm(dir, { recursive: true });
});

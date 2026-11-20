// Integration tests for the Raspberry Pi deployment (deploy/):
// - deploy.sh copies the app and is careful about where it deletes
// - deploy/nginx.conf.example, run in a real nginx with only paths, ports
//   and certificate swapped, serves the app, recipes and index correctly
// Skips the nginx part when nginx isn't installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, readdir, chmod } from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP } from '../../tools/dev-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const deployScript = path.join(root, 'deploy/deploy.sh');
const hasNginx = spawnSync('nginx', ['-v']).status === 0;

let tmp;
before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'recipes-deploy-'));
  await chmod(tmp, 0o755); // nginx workers may run as another user
});
after(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const deploy = (...args) => spawnSync('bash', [deployScript, ...args], { encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH } });

test('deploy.sh installs the app, removes stale app files, keeps unrelated recipes', async () => {
  const www = path.join(tmp, 'www', 'recipes');
  let r = deploy(www);
  assert.equal(r.status, 0, r.stderr);
  const files = await readdir(www);
  for (const f of ['index.html', 'css', 'js', 'icon.svg']) assert.ok(files.includes(f), f);

  await writeFile(path.join(www, 'old-file.js'), 'stale');
  await mkdir(path.join(www, 'recipes'));
  await writeFile(path.join(www, 'recipes', 'keep.json'), '{}');
  r = deploy(www);
  assert.equal(r.status, 0, r.stderr);
  const after2 = await readdir(www);
  assert.ok(!after2.includes('old-file.js'), 'stale file removed');
  assert.equal(await readFile(path.join(www, 'recipes', 'keep.json'), 'utf8'), '{}', 'recipes/ untouched');
});

test('deploy.sh refuses dangerous targets', async () => {
  const notApp = path.join(tmp, 'somewhere', 'documents');
  await mkdir(notApp, { recursive: true });
  await writeFile(path.join(notApp, 'precious.txt'), 'x');
  for (const [target, why] of [
    [notApp, /doesn't look like a previous install/],
    ['/tmp', /Refusing/],
    ['/', /Refusing/],
    [path.join(root, 'site'), /repository itself/],
  ]) {
    const r = deploy(target);
    assert.equal(r.status, 2, `${target}: ${r.stdout}`);
    assert.match(r.stderr, why);
  }
  assert.equal(await readFile(path.join(notApp, 'precious.txt'), 'utf8'), 'x');
  assert.equal(deploy('a', 'b').status, 2);
});

// ---------------------------------------------------------------- nginx

/** HTTPS/HTTP request that accepts the self-signed certificate. */
function request(url, { method = 'GET', headers = {} } = {}) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method, headers, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('nginx.conf.example serves the app, recipes and index as intended', { skip: !hasNginx && 'nginx not installed' }, async (t) => {
  const www = path.join(tmp, 'pi', 'www');
  const processed = path.join(tmp, 'nas', 'processed');
  const state = path.join(tmp, 'pi', 'state');
  const prefix = path.join(tmp, 'nginx');
  for (const d of [www, processed, state, prefix, path.join(prefix, 'ssl')]) await mkdir(d, { recursive: true });

  // App via deploy.sh, recipes as on the NAS, index built like the service does.
  assert.equal(deploy(www).status, 0);
  await cp(path.join(root, 'samples/recipes'), processed, { recursive: true });
  await rm(path.join(processed, 'index.json'), { force: true });
  await writeFile(path.join(processed, '.hidden-file'), 'secret');
  execFileSync(process.execPath, [path.join(root, 'tools/build-index.mjs'), processed, '--out', path.join(state, 'index.json'), '--if-changed']);
  assert.ok(!(await readdir(processed)).includes('index.json'), 'nothing written to the NAS folder');
  execFileSync('chmod', ['-R', 'a+rX', tmp]);

  const cert = path.join(prefix, 'ssl', 'cert.pem');
  const key = path.join(prefix, 'ssl', 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });

  const httpPort = 18080 + Math.floor(Math.random() * 500);
  const httpsPort = httpPort + 1000;
  let site = await readFile(path.join(root, 'deploy/nginx.conf.example'), 'utf8');
  const swaps = [
    ['listen 80;', `listen ${httpPort};`],
    ['listen [::]:80;', ''],
    ['listen 443 ssl;', `listen ${httpsPort} ssl;`],
    ['listen [::]:443 ssl;', ''],
    ['/etc/nginx/ssl/recipes.pem', cert],
    ['/etc/nginx/ssl/recipes-key.pem', key],
    ['root /var/www/recipes;', `root ${www};`],
    ['alias /var/lib/recipes/index.json;', `alias ${state}/index.json;`],
    ['alias /mnt/chipolata/recipes/processed/;', `alias ${processed}/;`],
    ['return 301 https://$host$request_uri;', `return 301 https://$host:${httpsPort}$request_uri;`],
  ];
  for (const [from, to] of swaps) {
    assert.ok(site.includes(from), `example config contains: ${from}`);
    site = site.replaceAll(from, to);
  }
  const mime = ['/etc/nginx/mime.types', '/usr/local/etc/nginx/mime.types'].find((p) => spawnSync('test', ['-f', p]).status === 0);
  const conf = `
pid ${prefix}/nginx.pid;
error_log ${prefix}/error.log warn;
events {}
http {
  include ${mime};
  default_type application/octet-stream;
  access_log off;
  client_body_temp_path ${prefix}/tmp_body;
  proxy_temp_path ${prefix}/tmp_proxy;
  fastcgi_temp_path ${prefix}/tmp_fastcgi;
  uwsgi_temp_path ${prefix}/tmp_uwsgi;
  scgi_temp_path ${prefix}/tmp_scgi;
${site}
}`;
  await writeFile(path.join(prefix, 'nginx.conf'), conf);
  const check = spawnSync('nginx', ['-t', '-p', prefix, '-c', path.join(prefix, 'nginx.conf')], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);

  const server = spawn('nginx', ['-p', prefix, '-c', path.join(prefix, 'nginx.conf'), '-g', 'daemon off;'], { stdio: 'ignore' });
  t.after(() => server.kill());
  const base = `https://localhost:${httpsPort}`;
  for (let i = 0; i < 50; i++) {
    try {
      await request(`${base}/`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  await t.test('app page with security headers', async () => {
    const r = await request(`${base}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.equal(r.headers['content-security-policy'], CSP, 'nginx CSP must match tools/dev-server.mjs');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cache-control'], 'no-cache');
  });

  await t.test('index comes from the Pi, gzipped, revalidated', async () => {
    const r = await request(`${base}/recipes/index.json`);
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body.toString()).recipes.length, 19);
    assert.equal(r.headers['cache-control'], 'no-cache');
    const gz = await request(`${base}/recipes/index.json`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(gz.headers['content-encoding'], 'gzip');
  });

  await t.test('recipe files and images from the NAS folder', async () => {
    const json = await request(`${base}/recipes/mains/slow-cooked-beef-ragu.json`);
    assert.equal(json.status, 200);
    assert.match(json.headers['content-type'], /application\/json/);
    const ld = await request(`${base}/recipes/drinks/ginger-lemonade.jsonld`);
    assert.equal(ld.status, 200);
    assert.match(ld.headers['content-type'], /application\/ld\+json/);
    assert.equal(ld.headers['content-security-policy'], CSP);
    const img = await request(`${base}/recipes/breakfast/shakshuka.svg`);
    assert.equal(img.status, 200);
    assert.equal(img.headers['cache-control'], 'public, max-age=86400');
  });

  await t.test('blocked: hidden files, listings, writes, traversal', async () => {
    assert.equal((await request(`${base}/recipes/.hidden-file`)).status, 404);
    assert.notEqual((await request(`${base}/recipes/`)).status, 200);
    assert.equal((await request(`${base}/`, { method: 'POST' })).status, 403);
    assert.equal((await request(`${base}/recipes/mains/slow-cooked-beef-ragu.json`, { method: 'DELETE' })).status, 403);
    for (const p of ['/recipes/..%2f..%2fpi/state/index.json', '/recipes/../../pi/state/index.json', '/recipes/%2e%2e/%2e%2e/pi/state/index.json']) {
      const { status } = await request(`${base}${p}`);
      assert.ok(status >= 400 && status < 500, `${p} → ${status}`); // nginx answers 400 or 404: either way, refused
    }
  });

  await t.test('http redirects to https', async () => {
    const r = await request(`http://localhost:${httpPort}/#/`);
    assert.equal(r.status, 301);
    assert.match(r.headers.location, new RegExp(`^https://localhost:${httpsPort}/`));
  });

  await t.test('the app runs in a browser behind nginx with no CSP or console errors', async (st) => {
    let chromium;
    try {
      ({ chromium } = await import('@playwright/test'));
    } catch {
      return st.skip('Playwright not installed');
    }
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${base}/#/?meal=Soup`);
      await page.waitForSelector('.card');
      assert.equal(await page.locator('.card').count(), 2);
      await page.goto(`${base}/#/recipe/breakfast/shakshuka`);
      await page.waitForSelector('.ingredient-list');
      assert.ok(await page.locator('img.recipe-media').evaluate((el) => el.naturalWidth > 0), 'image loads from the NAS path');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
});

test('cookbook snippets add the app at /cookbook/ to an existing site without disturbing it', { skip: !hasNginx && 'nginx not installed' }, async (t) => {
  // Mirrors the Pi: a default site serving /var/www/html, /garden and an older
  // /recipes page from the NAS mount, plus one include line for the app.
  const nas = path.join(tmp, 'shared', 'chipolata');
  const processed = path.join(nas, 'recipes', 'processed');
  const www = path.join(tmp, 'shared', 'www-recipes');
  const html = path.join(tmp, 'shared', 'html');
  const state = path.join(tmp, 'shared', 'state');
  const prefix = path.join(tmp, 'shared', 'nginx');
  for (const d of [processed, path.join(nas, 'garden'), html, state, path.join(prefix, 'snippets'), path.join(prefix, 'conf.d')]) {
    await mkdir(d, { recursive: true });
  }
  await writeFile(path.join(html, 'index.html'), 'default page');
  await writeFile(path.join(nas, 'garden', 'edinburgh_garden_planner.html'), 'garden planner');
  await writeFile(path.join(nas, 'recipes', 'recipe_book.html'), 'old recipe book');
  await cp(path.join(root, 'samples/recipes'), processed, { recursive: true });
  await rm(path.join(processed, 'index.json'), { force: true });
  await writeFile(path.join(processed, '.hidden.jpg'), 'secret');
  assert.equal(deploy(www).status, 0);
  execFileSync(process.execPath, [path.join(root, 'tools/build-index.mjs'), processed, '--out', path.join(state, 'index.json')]);
  execFileSync('chmod', ['-R', 'a+rX', tmp]);

  let locations = await readFile(path.join(root, 'deploy/nginx-cookbook-locations.conf'), 'utf8');
  for (const [from, to] of [
    ['alias /var/www/recipes/;', `alias ${www}/;`],
    ['alias /var/lib/recipes/index.json;', `alias ${state}/index.json;`],
    ['alias /mnt/chipolata/recipes/processed/;', `alias ${processed}/;`],
  ]) {
    assert.ok(locations.includes(from), `snippet contains: ${from}`);
    locations = locations.replaceAll(from, to);
  }
  await writeFile(path.join(prefix, 'snippets', 'cookbook.conf'), locations);
  await cp(path.join(root, 'deploy/nginx-cookbook-http.conf'), path.join(prefix, 'conf.d', 'cookbook.conf'));

  const port = 19080 + Math.floor(Math.random() * 500);
  const mime = ['/etc/nginx/mime.types', '/usr/local/etc/nginx/mime.types'].find((p) => spawnSync('test', ['-f', p]).status === 0);
  await writeFile(
    path.join(prefix, 'nginx.conf'),
    `pid ${prefix}/nginx.pid;
error_log ${prefix}/error.log warn;
events {}
http {
  include ${mime};
  default_type application/octet-stream;
  access_log off;
  client_body_temp_path ${prefix}/b; proxy_temp_path ${prefix}/p; fastcgi_temp_path ${prefix}/f; uwsgi_temp_path ${prefix}/u; scgi_temp_path ${prefix}/s;
  include ${prefix}/conf.d/*.conf;
  server {
    listen ${port} default_server;
    root ${html};
    index index.html index.htm index.nginx-debian.html;
    server_name _;
    include ${prefix}/snippets/cookbook.conf;
    location / { try_files $uri $uri/ =404; }
    location /recipes { root ${nas}/; index recipe_book.html; }
    location /garden { root ${nas}/; index edinburgh_garden_planner.html; }
  }
}`,
  );
  const check = spawnSync('nginx', ['-t', '-p', prefix, '-c', path.join(prefix, 'nginx.conf')], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const server = spawn('nginx', ['-p', prefix, '-c', path.join(prefix, 'nginx.conf'), '-g', 'daemon off;'], { stdio: 'ignore' });
  t.after(() => server.kill());
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      await request(`${base}/`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  await t.test('existing site is unchanged', async () => {
    assert.equal((await request(`${base}/`)).body.toString(), 'default page');
    assert.equal((await request(`${base}/garden/`)).body.toString(), 'garden planner');
    assert.equal((await request(`${base}/recipes/`)).body.toString(), 'old recipe book');
    assert.equal((await request(`${base}/garden/`)).headers['content-security-policy'], undefined, 'no headers leak into other paths');
  });

  await t.test('app, index, recipes and images under /cookbook/', async () => {
    const redirect = await request(`${base}/cookbook`);
    assert.equal(redirect.status, 301);
    assert.match(redirect.headers.location, /\/cookbook\/$/);
    const app = await request(`${base}/cookbook/`);
    assert.equal(app.status, 200);
    assert.match(app.body.toString(), /<title>Recipes<\/title>/);
    assert.equal(app.headers['content-security-policy'], CSP);
    assert.equal(app.headers['cache-control'], 'no-cache');
    const index = await request(`${base}/cookbook/recipes/index.json`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(index.status, 200);
    assert.equal(index.headers['content-encoding'], 'gzip');
    assert.equal(index.headers['content-security-policy'], CSP);
    const json = await request(`${base}/cookbook/recipes/mains/slow-cooked-beef-ragu.json`);
    assert.equal(json.status, 200);
    assert.equal(json.headers['cache-control'], 'no-cache');
    const ld = await request(`${base}/cookbook/recipes/drinks/ginger-lemonade.jsonld`);
    assert.match(ld.headers['content-type'], /application\/ld\+json/);
    const img = await request(`${base}/cookbook/recipes/breakfast/shakshuka.svg`);
    assert.equal(img.status, 200);
    assert.equal(img.headers['cache-control'], 'public, max-age=86400');
    assert.equal(img.headers['content-security-policy'], CSP);
  });

  await t.test('blocked under /cookbook/: hidden files, listings, writes', async () => {
    assert.equal((await request(`${base}/cookbook/recipes/.hidden.jpg`)).status, 404);
    assert.notEqual((await request(`${base}/cookbook/recipes/`)).status, 200);
    assert.equal((await request(`${base}/cookbook/`, { method: 'POST' })).status, 403);
    assert.equal((await request(`${base}/cookbook/recipes/drinks/ginger-lemonade.jsonld`, { method: 'PUT' })).status, 403);
  });

  await t.test('the app runs under /cookbook/ in a browser', async (st) => {
    let chromium;
    try {
      ({ chromium } = await import('@playwright/test'));
    } catch {
      return st.skip('Playwright not installed');
    }
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${base}/cookbook/#/?q=soup`);
      await page.waitForSelector('.card');
      assert.ok((await page.locator('.card').count()) >= 2);
      await page.goto(`${base}/cookbook/#/recipe/soups/roast-tomato-soup`);
      await page.waitForSelector('.ingredient-list');
      assert.ok(await page.locator('img.recipe-media').evaluate((el) => el.naturalWidth > 0));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
});

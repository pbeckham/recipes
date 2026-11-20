#!/usr/bin/env node
// Local static server for development. Node >= 20, built-in modules only.
// Serves site/ at <base> and a recipes folder at <base>recipes/. The
// recipes/index.json it serves is rebuilt in memory on every request, so new
// or edited recipe files show up on reload. Nothing is written to disk.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildIndex } from './build-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: node tools/dev-server.mjs [options]

Options:
  --recipes <dir>  Recipes folder to serve (default: samples/recipes)
  --port <n>       Port (default: 8080)
  --host <addr>    Address to listen on (default: 127.0.0.1; use 0.0.0.0 to try it from your phone)
  --base <path>    URL base path, e.g. /recipes/ to mimic GitHub Pages (default: /)
  -h, --help       Show this help`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonld': 'application/ld+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Resolve a URL path inside a root folder; null if it escapes the root.
 * @param {string} root
 * @param {string} urlPath decoded, "/"-separated, no leading slash
 */
function safeJoin(root, urlPath) {
  const full = path.resolve(root, `.${path.posix.sep}${urlPath}`);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

/**
 * Create the request handler (exported for tests).
 * @param {{ siteDir: string, recipesDir: string, base: string, log?: (line: string) => void }} options
 */
export function createHandler({ siteDir, recipesDir, base, log = () => {} }) {
  return async function handle(req, res) {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
      log(`${status} ${req.method} ${req.url}`);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed', { Allow: 'GET, HEAD' });

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return send(400, 'Bad request');
    }
    if (pathname.includes('\0')) return send(400, 'Bad request');
    if (pathname === base.replace(/\/$/, '') && base !== '/') return send(301, '', { Location: base });
    if (!pathname.startsWith(base)) return send(404, 'Not found');

    let rel = pathname.slice(base.length);
    let root = siteDir;
    if (rel === 'recipes' || rel.startsWith('recipes/')) {
      root = recipesDir;
      rel = rel.slice('recipes/'.length);
      if (rel === 'index.json') {
        const { index, warnings } = await buildIndex(recipesDir);
        for (const w of warnings) log(`warning: ${w.file}: ${w.message}`);
        return send(200, JSON.stringify(index), { 'Content-Type': TYPES['.json'] });
      }
    }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';

    const file = safeJoin(root, rel);
    if (!file || rel.split('/').some((seg) => seg.startsWith('.'))) return send(404, 'Not found');
    try {
      const info = await stat(file);
      if (!info.isFile()) return send(404, 'Not found');
      const body = await readFile(file);
      return send(200, body, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    } catch {
      return send(404, 'Not found');
    }
  };
}

/**
 * Start the server.
 * @param {{ recipesDir?: string, port?: number, host?: string, base?: string, quiet?: boolean }} [options]
 * @returns {Promise<http.Server>}
 */
export async function startServer({ recipesDir = path.join(ROOT, 'samples/recipes'), port = 8080, host = '127.0.0.1', base = '/', quiet = false } = {}) {
  const normBase = `/${base.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
  const handler = createHandler({
    siteDir: path.join(ROOT, 'site'),
    recipesDir: path.resolve(recipesDir),
    base: normBase,
    log: quiet ? () => {} : (line) => console.log(line),
  });
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal error');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  if (!quiet) {
    const shown = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Serving ${path.relative(process.cwd(), path.resolve(recipesDir)) || '.'} at http://${shown}:${port}${normBase}`);
  }
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  try {
    args = parseArgs({
      options: {
        recipes: { type: 'string' },
        port: { type: 'string' },
        host: { type: 'string' },
        base: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  const { values } = args;
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const recipesDir = values.recipes ? path.resolve(values.recipes) : undefined;
  if (recipesDir) {
    try {
      if (!(await stat(recipesDir)).isDirectory()) throw new Error();
    } catch {
      console.error(`Recipes folder not found: ${recipesDir}`);
      process.exit(2);
    }
  }
  await startServer({
    recipesDir,
    port: values.port ? Number(values.port) : undefined,
    host: values.host,
    base: values.base,
  });
}

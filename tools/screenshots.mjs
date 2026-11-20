#!/usr/bin/env node
// Capture screenshots of the app at phone and tablet sizes, light and dark,
// for reviewing UI changes (see CLAUDE.md). Needs the @playwright/test
// devDependency (npm install) and its Chromium (npx playwright install chromium).
//
//   node tools/screenshots.mjs [--out screenshots] [--scale 1] [--route '#/recipe/x' ...]

import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { startServer } from './dev-server.mjs';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'screenshots' },
    scale: { type: 'string', default: '1' },
    route: { type: 'string', multiple: true },
    'full-page': { type: 'boolean', default: false },
  },
});

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 820, height: 1180 },
  { name: 'tablet-landscape', width: 1180, height: 820 },
];
const ROUTES = values.route ?? ['#/', '#/recipe/mains/slow-cooked-beef-ragu', '#/recipe/soups/roast-tomato-soup'];
const PORT = 4179;

const server = await startServer({ port: PORT, base: '/recipes/', quiet: true });
const browser = await chromium.launch();
const outDir = path.resolve(values.out);
await mkdir(outDir, { recursive: true });
const errors = [];

try {
  for (const scheme of ['light', 'dark']) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: Number(values.scale),
        colorScheme: scheme,
        hasTouch: vp.name !== 'tablet-landscape',
      });
      const page = await context.newPage();
      page.on('console', (m) => m.type() === 'error' && errors.push(`${vp.name}/${scheme}: ${m.text()}`));
      page.on('pageerror', (e) => errors.push(`${vp.name}/${scheme}: ${e.message}`));
      for (const route of ROUTES) {
        await page.goto(`http://127.0.0.1:${PORT}/recipes/${route}`);
        await page.waitForLoadState('networkidle');
        await page.waitForFunction(() => !document.querySelector('.loading'));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) errors.push(`${vp.name}/${scheme} ${route}: horizontal overflow of ${overflow}px`);
        const slug = route.replace(/^#\/?/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
        const file = path.join(outDir, `${slug}--${vp.name}--${scheme}.png`);
        await page.screenshot({ path: file, fullPage: values['full-page'] });
        console.log(path.relative(process.cwd(), file));
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error(`\nProblems:\n  ${errors.join('\n  ')}`);
  process.exitCode = 1;
}

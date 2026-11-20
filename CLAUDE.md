# CLAUDE.md

Guidance for Claude (and humans) working in this repo. The requirements live in `README.md`, and the IDs (R1, N3, …) are referenced below. Read the README before starting a phase.

## Hard constraints
- **`site/` has no build step and no runtime dependencies.** Plain HTML, CSS and native ES modules only. No frameworks, no bundlers, no CDN `<script>`/`<link>` tags, no web fonts loaded from the internet (N1, N2).
- **Relative URLs only, hash routing only.** Never write `href="/…"` or `fetch("/…")`. The app must work at `/` and at `/recipes/` on GitHub Pages (N3).
- **Tooling uses only Node ≥ 20 built-ins** (`node:fs`, `node:path`, `node:test`, `node:http`). The only allowed npm package is `@playwright/test` as a devDependency for e2e tests (N7).
- **Single JSON-LD normalizer.** All parsing of recipe shapes goes in `site/js/jsonld.js`, which the browser and `tools/` both import. Don't duplicate the logic.
- **Never commit real/personal recipes.** `site/recipes/` is gitignored. Recipes in `samples/recipes/` must be original text written for this repo (CC0). Do not copy recipes from websites or cookbooks.

## Commands
```bash
node tools/build-index.mjs samples/recipes   # build sample index
node tools/dev-server.mjs                    # http://localhost:8080 with sample recipes
node --test test/unit                        # unit tests (fast, run always)
npx playwright test --trace off              # e2e tests (run when UI changes)
```

## Development flow
1. Work one roadmap phase (or one smaller slice of one) per branch/PR. Check that the README roadmap is the current plan.
2. Write or extend unit tests first for data logic (`jsonld.js`, `search.js`, `scale.js`). Each JSON-LD shape in R2 needs a test fixture in `test/fixtures/`.
3. Implement.
4. Verify:
   - `node --test test/unit` passes.
   - `node tools/build-index.mjs samples/recipes` prints no warnings (except from fixtures that are meant to be bad, which live in `test/fixtures/`, not in samples).
   - For UI changes, run the dev server and take Playwright screenshots at phone (390×844) and desktop (1280×800) widths, in light and dark mode. Look at them before claiming the change works.
5. Update the README when behaviour, commands or the index format change. Tick off the roadmap phase when it's done.
6. Commit with a clear message (`phase 2: recipe view with section headings`) and push to the working branch. Open a PR only when asked.

## Definition of done
- Requirement IDs addressed are listed in the PR/commit description.
- Unit tests cover new logic. Every e2e test passes.
- Works with JavaScript modules served from a sub-path (the dev server's `--base /recipes/` option simulates GitHub Pages).
- No console errors. Keyboard navigation works. Contrast is OK in both colour schemes.

## Code style
- Modern JS (ES2022), `const`/`let`, small pure functions, JSDoc type comments on exported functions.
- DOM is built with `document.createElement` or `<template>` + `textContent`. **Never put recipe data into `innerHTML`.** Recipe files are untrusted input.
- CSS: custom properties for colour tokens on `:root`, with dark mode via `prefers-color-scheme`. Mobile-first media queries.
- Keep files small and focused. Prefer clarity to cleverness: this should stay maintainable for years without tooling churn.

## Sample recipes
Keep 10–15 samples that together exercise every R2 shape: `HowToSection`, plain-string instructions, `@graph`, `@type` arrays, missing image, missing `totalTime`, keyword string vs array, subfolders, and a relative image path. Images in samples should be small (< 150 KB), original or CC0, or omitted.

# CLAUDE.md

Guidance for Claude (and humans) working in this repo. The requirements live in `README.md`, and the IDs (R1, N3, …) are referenced below. Read the README before starting a phase.

## Hard constraints
- **`site/` has no build step and no runtime dependencies.** Plain HTML, CSS and native ES modules only. No frameworks, no bundlers, no CDN `<script>`/`<link>` tags, no web fonts loaded from the internet (N1, N2).
- **Relative URLs only, hash routing only.** Never write `href="/…"` or `fetch("/…")`. The app must work at `/` and at `/recipes/` on GitHub Pages (N3).
- **Tooling uses only Node ≥ 20 built-ins** (`node:fs`, `node:path`, `node:test`, `node:http`). The only allowed npm package is `@playwright/test` as a devDependency for e2e tests (N7).
- **Single JSON-LD normalizer and taxonomy.** All parsing of recipe shapes goes in `site/js/jsonld.js`, and all facet values, synonyms and inference rules go in `site/js/taxonomy.js`. The browser and `tools/` both import them. Don't duplicate the logic or hard-code facet values anywhere else.
- **Facet values are fixed** (Meal, Protein, Carb; see README → Categories). Changing them is a requirements change: update the README first.
- **Mobile-first.** Write the base CSS for a 390 px-wide phone and add tablet layouts with `min-width` media queries. Touch targets ≥ 44 px, nothing relies on hover, and filters live in a bottom sheet on phones (N4).
- **Never commit real/personal recipes.** `site/recipes/` is gitignored. Recipes in `samples/recipes/` must be original text written for this repo (CC0). Do not copy recipes from websites or cookbooks.

## Commands
```bash
npm test                                     # unit tests (node --test, fast, run always)
npm run index:samples                        # build sample index with --strict --report
npm run dev                                  # http://localhost:8080 with sample recipes
npm run e2e -- --trace off                   # e2e tests, phone + tablet (run when UI changes)
npm run screenshots -- --out <dir>           # phone/tablet × light/dark; exits 1 on console errors or horizontal overflow
```

## Development flow
1. Work one roadmap phase (or one smaller slice of one) per branch/PR. Check that the README roadmap is the current plan.
2. Write or extend unit tests first for data logic (`jsonld.js`, `taxonomy.js`, `search.js`, `scale.js`).
   - Each JSON-LD shape in R2 needs a test fixture in `test/fixtures/`.
   - Inference rules need tests for both positive cases and known traps: fish sauce in a beef dish, chicken stock in a "vegetarian-looking" risotto, breadcrumbs that aren't the carb.
3. Implement.
4. Verify:
   - `npm test` passes.
   - `npm run index:samples` prints no warnings. Fixtures that are meant to be bad live in `test/fixtures/`, never in `samples/`.
   - For UI changes, run `npm run screenshots` (add `--route '#/recipe/<id>'` for specific pages). It captures light and dark mode at:
     - phone 390×844 (primary)
     - tablet portrait 820×1180
     - tablet landscape 1180×820
     
     Look at them before claiming the change works. Check there's no horizontal scroll on the phone screenshot.
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
Keep 15–20 samples that together:
- cover **every Meal, Protein and Carb value at least once**, with some recipes having several values in a facet;
- include 2–3 recipes with **no facet tags**, so inference is exercised on the Pages demo;
- spread total times across all the time-filter presets, with one recipe that has no time at all;
- link some recipes to a cookbook in each supported way: `isPartOf`, a `book:` keyword, and matched by title through `samples/recipes/books.json`. That file must include missing entries and one book without a contents list, so the Books page shows partial progress;
- exercise every R2 shape: `HowToSection`, plain-string instructions, `@graph`, `@type` arrays, missing image, missing `totalTime`, keyword string vs array, subfolders, and a relative image path. Images in samples should be small (< 150 KB), original or CC0, or omitted.

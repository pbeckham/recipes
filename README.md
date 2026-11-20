# Recipes

A static recipe browser. You keep recipes as [schema.org `Recipe`](https://developers.google.com/search/docs/appearance/structured-data/recipe) JSON-LD files in a folder. A small Node script builds a search index from them, and a plain HTML/CSS/JS app (with no build step and no runtime dependencies) lets you browse, search and cook from them.

It runs in two places:

| Target | Recipes | Hosting |
|---|---|---|
| **Home network** | Your own recipes, kept on the NAS | Files on the NAS, served by nginx on a Raspberry Pi |
| **GitHub Pages** | Original sample recipes released under CC0 (`samples/recipes/`) | Built and deployed by GitHub Actions |

---

## Requirements

### Functional

**Data**
- R1. Read recipes from `*.json` and `*.jsonld` files in one recipes folder. Subfolders are allowed and scanned recursively.
- R2. Accept the JSON-LD shapes found in the wild:
  - a single object, a top-level array, or a `@graph` container (use the node whose `@type` is or includes `Recipe`)
  - `@type` given as a string or an array
  - `recipeInstructions` given as a string, an array of strings, `HowToStep[]`, or `HowToSection[]` (sections containing steps)
  - `image` given as a string, an array, or an `ImageObject`. Relative paths resolve against the recipe file's own folder.
  - `keywords` given as a comma-separated string or an array
  - `recipeYield` given as a number, a string or an array
  - `prepTime`, `cookTime` and `totalTime` as ISO 8601 durations (`PT1H30M`). Derive `totalTime` from prep + cook when it is missing.
- R3. The index script (`tools/build-index.mjs`) writes `index.json` into the recipes folder with a compact summary of each recipe (see [Index format](#index-format)). It prints a warning for any file that fails to parse or lacks `name`, and skips that file without stopping.
- R4. Images sit next to their JSON files (`lasagne.json` + `lasagne.jpg`). Recipes without an image show a neutral placeholder.

**Browse & search** (Phase 3)
- R5. A home view lists recipes as cards showing image, name and total time.
- R6. Full-text search over name, description, keywords and ingredients. It is case- and accent-insensitive and runs entirely in the browser.
- R7. Filters for category (`recipeCategory`), cuisine (`recipeCuisine`), keyword, maximum total time, and "contains ingredient". Filters combine with AND.
- R8. The search and filter state lives in the URL, so a filtered view can be bookmarked or shared.

**Recipe view & cooking helpers** (Phase 2 / 4)
- R9. The recipe view shows name, image, description, times, yield, ingredients, instructions (with section headings), nutrition if present, and a link to the original source if `url` or `isBasedOn` is present.
- R10. Serving scaler: changing the servings scales ingredient quantities. Quantities are parsed best-effort from the start of each ingredient line (`2`, `1.5`, `1 1/2`, `½`, `2-3`). Lines that can't be parsed are shown unchanged.
- R11. Tap an ingredient or step to check it off. Check-offs last for the session only.
- R12. "Keep screen awake" toggle using the Screen Wake Lock API, hidden where the API isn't supported.
- R13. A print stylesheet that prints the recipe cleanly on one or two pages, without navigation chrome.

### Non-functional
- N1. **No build step for the app.** `site/` is plain HTML, CSS and ES modules, and you deploy it by copying.
- N2. **No runtime dependencies.** No CDN scripts either. The app must work on a LAN without internet access.
- N3. **Works under any base path.** All URLs are relative and routing is hash-based (`#/recipe/<id>`). This lets the same files run at `http://recipes.lan/` and at `https://<user>.github.io/recipes/` without server rewrites.
- N4. Mobile-first and usable one-handed on a phone or tablet in the kitchen. Supports light and dark mode.
- N5. Accessible: semantic HTML, keyboard navigable, visible focus, WCAG AA contrast.
- N6. Fast with 1,000+ recipes. The list and search use only `index.json`, and a full recipe file is fetched only when you open it.
- N7. Tooling runs on Node ≥ 20 using only built-in modules, so it runs on a Raspberry Pi as-is.

### Out of scope (for now)
Favourites, shopping lists, meal plans, offline/PWA, an in-app editor, and importing from websites. Each could be a later phase. See [Roadmap](#roadmap).

---

## Repository layout

```
site/                   The deployable static app (copy this to the NAS)
  index.html
  css/
  js/
    app.js              Entry point and hash router
    jsonld.js           JSON-LD → normalized Recipe (shared with tools/)
    search.js           Index search and filtering
    scale.js            Ingredient quantity parsing and scaling
    views/              Home, recipe and other views
  recipes/              ← NOT in git. Your recipes plus the generated index.json
samples/recipes/        CC0 sample recipes used for development, tests and GitHub Pages
tools/
  build-index.mjs       Scan a recipes folder → write index.json
  dev-server.mjs        Local static server (site/ at /, a chosen recipes folder at /recipes/)
test/                   node:test unit tests and Playwright end-to-end tests
deploy/
  nginx.conf.example
  recipes-index.cron.example
.github/workflows/
  ci.yml                Tests and index build on every PR
  pages.yml             Deploy site/ + samples to GitHub Pages on push to main
```

`site/js/jsonld.js` is a plain ES module that both the browser and `tools/build-index.mjs` import, so there is a single normalizer.

## Index format

`recipes/index.json`:

```json
{
  "version": 1,
  "generated": "2026-11-20T12:00:00Z",
  "recipes": [
    {
      "id": "mains/lasagne",
      "file": "mains/lasagne.json",
      "name": "Weeknight Lasagne",
      "description": "…",
      "image": "mains/lasagne.jpg",
      "category": ["Main course"],
      "cuisine": ["Italian"],
      "keywords": ["pasta", "make-ahead"],
      "totalMinutes": 75,
      "yield": "6 servings",
      "ingredients": ["500 g beef mince", "…"]
    }
  ]
}
```

`id` is the file path relative to the recipes folder, without its extension. It appears in URLs: `#/recipe/mains/lasagne`.

---

## Usage

### Local development

```bash
node tools/build-index.mjs samples/recipes
node tools/dev-server.mjs                      # serves samples at http://localhost:8080
node tools/dev-server.mjs --recipes ~/my-recipes
```

### Tests

```bash
node --test test/unit        # unit tests, no dependencies
npx playwright test          # end-to-end tests (dev dependency only)
```

### Home network deployment (NAS + Raspberry Pi)

1. Copy `site/` to the NAS, e.g. `/volume1/web/recipes/`. When you update the app later, leave your recipes alone:
   ```bash
   rsync -av --delete --exclude 'recipes/' site/ nas:/volume1/web/recipes/
   ```
2. Put your recipe files in `/volume1/web/recipes/recipes/`. Subfolders are fine.
3. On the Pi, with the NAS share mounted, rebuild the index after adding recipes, or on a schedule (see `deploy/recipes-index.cron.example`):
   ```bash
   node tools/build-index.mjs /mnt/nas/web/recipes/recipes
   ```
4. Point nginx at the folder (see `deploy/nginx.conf.example`). Serve `index.json` with `Cache-Control: no-cache` so new recipes appear straight away.

### GitHub Pages

Pushing to `main` runs `.github/workflows/pages.yml`. It copies `site/`, copies `samples/recipes/` into `recipes/`, builds the index and deploys. Enable it under **Settings → Pages → Source: GitHub Actions**.

---

## Roadmap

| Phase | Deliverable | Requirements |
|---|---|---|
| 0 | README, CLAUDE.md, repo skeleton, CI | — |
| 1 | JSON-LD normalizer, index builder, 10–15 CC0 sample recipes, unit tests | R1–R4 |
| 2 | App shell, hash router, recipe list, recipe view, GitHub Pages deploy | R5, R9, N1–N5 |
| 3 | Search and filters | R6–R8, N6 |
| 4 | Cooking helpers: scaler, check-off, wake lock, print | R10–R13 |
| 5 | NAS deployment: nginx and cron examples, documented end to end | — |
| Later | Favourites, shopping list, PWA/offline, validator CLI, import-from-URL CLI | — |

## Open questions
- Units: show recipes as written, or add metric/imperial conversion? (Currently: as written.)
- License for the app code (sample recipes are CC0).

## Licence
Sample recipes in `samples/recipes/` are original works dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). App code licence: TBD.

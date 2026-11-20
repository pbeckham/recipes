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
  - `keywords` given as a comma-separated string or an array. Keywords with a facet prefix (`protein:…`, `carb:…`, `meal:…`) are treated as categories, not shown as ordinary tags (see [Categories](#categories)).
  - `recipeYield` given as a number, a string or an array
  - `prepTime`, `cookTime` and `totalTime` as ISO 8601 durations (`PT1H30M`). Derive `totalTime` from prep + cook when it is missing.
- R3. The index script (`tools/build-index.mjs`) writes `index.json` into the recipes folder with a compact summary of each recipe (see [Index format](#index-format)). It prints a warning for any file that fails to parse or lacks `name`, and skips that file without stopping.
- R4. Images sit next to their JSON files (`lasagne.json` + `lasagne.jpg`). Recipes without an image show a neutral placeholder.

**Categories** (Phase 1 data, Phase 3 UI). See [Categories](#categories) for the full taxonomy.
- R14. Every recipe has three category facets: **Meal**, **Protein** and **Carb**. Each facet can hold several values (surf and turf is both *Beef* and *Fish & Seafood*).
- R15. Explicit values come from the file:
  - Meal from `recipeCategory`, mapped through a synonym list (e.g. "Main course", "Dinner" and "Entrée" all become *Main*), or from a `meal:` keyword.
  - Protein and carb from `protein:` and `carb:` keywords, e.g. `"keywords": "protein:Poultry, carb:Rice, weeknight"`. Common synonyms are accepted too, so `protein:Chicken` or `protein:Duck` resolve to *Poultry*.
  
  Matching is case-insensitive and also uses the synonym list.
- R16. When a recipe has no explicit value for a facet, the index script infers it: protein and carb from the ingredients, meal from the recipe name and keywords. Inferred values are marked as inferred in the index. Explicit values always win, per facet.
- R17. `build-index.mjs --report` lists recipes with inferred or uncategorised facets, so you can see which recipes would benefit from tags.

**Browse, search & filter** (Phase 3)
- R5. A home view lists recipes as cards showing image, name, total time and Meal/Protein/Carb badges.
- R6. Full-text search over name, description, keywords and ingredients. It is case- and accent-insensitive and runs entirely in the browser.
- R7. **Category filters** for Meal, Protein and Carb, plus cuisine (`recipeCuisine`). Values within one facet combine with OR (Poultry *or* Pork); different facets combine with AND (Main *and* Rice). Each option shows how many recipes match, and options with no matches are disabled.
- R18. **Cooking time filter**: presets of ≤ 15, ≤ 30, ≤ 45, ≤ 60 and ≤ 90 minutes on total time. While a time filter is active, recipes with no known time are hidden and the app says how many were hidden. The list can be sorted by name, by total time, or by newest.
- R19. **Ingredient filter, must include**: choose one or more ingredients and only recipes containing *all* of them are shown. Matching is on whole words, case- and accent-insensitive, with simple plurals (`tomato` matches "2 tomatoes, diced"). As you type, the app suggests ingredients from a vocabulary built from the index.
- R8. Search, filter and sort state lives in the URL, so a filtered view can be bookmarked or shared.

**Recipe view & cooking helpers** (Phase 2 / 4)
- R9. The recipe view shows name, image, description, category badges, times, yield, ingredients, instructions (with section headings), nutrition if present, and a link to the original source if `url` or `isBasedOn` is present.
- R10. Serving scaler: changing the servings scales ingredient quantities. Quantities are parsed best-effort from the start of each ingredient line (`2`, `1.5`, `1 1/2`, `½`, `2-3`). Lines that can't be parsed are shown unchanged.
- R11. Tap an ingredient or step to check it off. Check-offs last for the session only.
- R12. "Keep screen awake" toggle using the Screen Wake Lock API, hidden where the API isn't supported.
- R13. A print stylesheet that prints the recipe cleanly on one or two pages, without navigation chrome.

### Non-functional
- N1. **No build step for the app.** `site/` is plain HTML, CSS and ES modules, and you deploy it by copying.
- N2. **No runtime dependencies.** No CDN scripts either. The app must work on a LAN without internet access.
- N3. **Works under any base path.** All URLs are relative and routing is hash-based (`#/recipe/<id>`). This lets the same files run at `http://recipes.lan/` and at `https://<user>.github.io/recipes/` without server rewrites.
- N4. **Mobile-first.** Designed for phones first, tablets second; desktop just has to work.
  - **Phone (360–430 px wide, primary):** one column. The search bar stays at the top while scrolling. Filters open in a bottom sheet with a "Show N recipes" button. Active filters appear as removable chips under the search bar. Primary controls sit within thumb reach.
  - **Tablet (768–1180 px, portrait and landscape):** a multi-column recipe grid. On wide screens the recipe view puts ingredients next to the steps, so you can see both while cooking.
  - Touch targets are at least 44×44 px. Body text is at least 16 px, and larger in the recipe view so it can be read from arm's length. No interaction depends on hover.
  - Light and dark mode follow the system setting.
- N5. Accessible: semantic HTML, keyboard navigable, visible focus, WCAG AA contrast.
- N6. Fast with 1,000+ recipes. The list and search use only `index.json`, and a full recipe file is fetched only when you open it.
- N7. Tooling runs on Node ≥ 20 using only built-in modules, so it runs on a Raspberry Pi as-is.

### Out of scope (for now)
Favourites, shopping lists, meal plans, offline/PWA, an in-app editor, and importing from websites. Each could be a later phase. See [Roadmap](#roadmap).

---

## Performance with large collections

The app is designed for 1,000+ recipes (N6):
- **The list renders in batches** of 48 cards, with more added as you scroll. Cards far off-screen skip layout and painting (`content-visibility: auto`).
- **The built list is kept** when you open a recipe, so going back is instant and returns to the same card.
- **Images load lazily.** Search and filters work on the in-memory `index.json`, and a recipe file is only fetched when you open it.

Measured with 1,520 recipes on an emulated Pixel 7 with the CPU slowed 4×, served statically:

| | Result |
|---|---|
| `build-index.mjs` | under 1 s |
| `index.json` | ~1.1 MB raw (nginx `gzip on` cuts it to a few hundred KB for real recipes) |
| First screen of the list | ~0.55 s, including preparing the search index |
| Toggling a filter (results, counts and URL updated) | ~60–80 ms |
| Back from a recipe | ~0.4–0.5 s, same card in the same place |

Without batching the same list took 3.5 s to appear and 7.8 s to come back to.

## Repository layout

```
site/                   The deployable static app (copy this to the NAS)
  index.html
  css/
  js/
    app.js              Entry point and hash router
    jsonld.js           JSON-LD → normalized Recipe (shared with tools/)
    taxonomy.js         Facet values, synonyms and inference rules (shared with tools/)
    text.js             Text normalization and whole-word term matching (shared with tools/)
    search.js           Search, filters, counts, sorting and URL state (pure; unit-tested)
    scale.js            Ingredient quantity parsing and scaling (pure; unit-tested)
    cooking.js          Per-recipe session state (servings, ticks) and Screen Wake Lock
    data.js             Loading index.json and recipe files
    dom.js              Tiny DOM helpers (text only, never innerHTML for recipe data)
    format.js           Times and nutrition labels
    views/              Home, recipe and shared view pieces
  recipes/              ← NOT in git. Your recipes plus the generated index.json
samples/recipes/        CC0 sample recipes used for development, tests and GitHub Pages
tools/
  build-index.mjs       Scan a recipes folder → write index.json
  dev-server.mjs        Local static server (site/ at /, a chosen recipes folder at /recipes/)
  screenshots.mjs       Phone/tablet × light/dark screenshots for reviewing UI changes
test/
  unit/                 node:test unit tests
  e2e/                  Playwright end-to-end tests
  fixtures/             Deliberately broken/odd recipe files for tests
  deploy/               deploy.sh and the nginx config, run in a real nginx
deploy/
  README.md             Step-by-step Raspberry Pi guide
  deploy.sh             Install/update the app on the Pi
  nginx.conf.example    nginx site (HTTPS, NAS folder mapping, caching, CSP)
  recipes-index.*       systemd service + timer that rebuild the index
.github/workflows/
  ci.yml                Tests and index build on every PR
  pages.yml             Deploy site/ + samples to GitHub Pages on push to main
```

`site/js/jsonld.js`, `site/js/taxonomy.js` and `site/js/text.js` are plain ES modules that both the browser and `tools/build-index.mjs` import, so the normalization and categorisation logic exists in one place.

## Categories

The facet values are fixed and defined in `site/js/taxonomy.js`:

| Facet | Values | Explicit source |
|---|---|---|
| **Meal** | Breakfast, Starter, Soup, Salad, Main, Side, Dessert, Baking, Snack, Sauce & Condiment, Drink | `recipeCategory` (via synonyms) or `meal:` keyword |
| **Protein** | Fish & Seafood, Poultry, Beef, Pork, Lamb, Vegetarian, Other | `protein:` keyword |
| **Carb** | Bread, Pasta, Noodles, Rice, Grains, Potato, None / Other | `carb:` keyword |

**Tagging example**

```json
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Chicken & Chorizo Rice",
  "recipeCategory": "Main course",
  "keywords": "protein:Poultry, protein:Pork, carb:Rice, one-pot, weeknight"
}
```

**How values are inferred when a facet has no tags (R16)**
- **Protein:** look for main-ingredient terms in the ingredient lines, e.g. "chicken thighs" or "duck breast" → Poultry, "prawns" → Fish & Seafood.
  - Flavourings such as fish sauce, anchovy paste, oyster sauce and stock add no protein.
  - They do rule out *Vegetarian*: a recipe is inferred Vegetarian only if no meat or fish term appears anywhere, including stock, gelatine and anchovies. A recipe whose only animal ingredients are flavourings (e.g. a mushroom risotto made with chicken stock) gets no protein value and shows as *Uncategorised*.
  - Look-alikes are ignored: beef tomatoes, lamb's lettuce, vegetable stock, vegetarian sausages.
  - Poultry covers chicken, turkey, duck, goose and similar birds. Other meats (venison, rabbit, goat, game) map to *Other*.
- **Carb:** match terms such as spaghetti or penne → Pasta, rice or risotto → Rice, potato or gnocchi → Potato, couscous, quinoa or bulgur → Grains, tortilla, naan or bread → Bread. Rice noodles are Noodles, not Rice. Breadcrumbs, flour, rice vinegar and the like don't count. Anything else is *None / Other*.
- **Meal:** words in the recipe name, e.g. "soup" or "chowder" → Soup, "cake", "loaf" or "muffin" → Baking. Only the part of the name before "with" or a comma is used, and the last matching word wins, because English dish names end in the main noun: "Bread Sauce" is a sauce, "Banana Bread" is baking. If the name doesn't match, keywords and `recipeCategory` are tried. If nothing matches, the recipe is *Uncategorised*.

Inference is a convenience for untagged recipes, such as ones exported from websites. Where it guesses wrong, adding tags to the file fixes it. Run `build-index.mjs --report` to see which recipes rely on inference. All word lists live in `site/js/taxonomy.js`.

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
      "meal": ["Main"],
      "protein": ["Beef"],
      "carb": ["Pasta"],
      "inferred": ["protein"],
      "cuisine": ["Italian"],
      "keywords": ["make-ahead"],
      "totalMinutes": 75,
      "added": "2026-11-02T18:30:00Z",
      "yield": "6 servings",
      "ingredients": ["500 g beef mince", "…"]
    }
  ]
}
```

- `id` is the file path relative to the recipes folder, without its extension. It appears in URLs: `#/recipe/mains/lasagne`.
- `inferred` lists the facets whose values were guessed rather than tagged.
- `keywords` excludes facet-prefixed keywords.
- `added` is the file's modification time, used for "newest" sorting.
- The top level also contains `ingredientVocabulary`: `[{ "term": "garlic", "count": 10 }, …]`, most common first. These are normalized single words and common two-word terms ("olive oil"), counted by the number of recipes using them. The ingredient filter uses it for suggestions.
- `index.json` is written without whitespace to keep it small.

---

## Searching and filtering

- **Search box:** every word must match the start of a word in the name, description, tags, cuisine, categories or ingredients. Matching ignores case and accents, so "chick ragu" finds "Chicken" and "Ragù". Name matches rank first ("Best match").
- **Filters** button: on a phone this opens a bottom sheet, on a tablet a side panel.
  - **Meal, Protein, Carb and Cuisine:** choices within a group mean "or", and different groups mean "and". Each option shows how many recipes you'd get, and options with none are disabled.
  - **Total time:** ≤ 15 min, ≤ 30 min, ≤ 45 min, ≤ 1 hr or ≤ 1½ hrs. Recipes with no time are hidden while this is set, and the app says how many.
  - **Must include:** add ingredients, with suggestions as you type. Recipes must contain all of them. Matching is on whole words and allows plurals, so "tomato" finds "tomatoes".
- **Active filters** appear as chips under the search box. Tap one to remove it.
- **Sort:** best match (while searching), name, quickest first, or newest first.
- **Shareable URLs:** everything is kept in the URL, e.g. `#/?q=soup&meal=Main&protein=Poultry&time=60&ing=garlic&sort=time`, so a filtered view can be bookmarked or shared. Opening a recipe and going back keeps the filters and your place in the list.

## Cooking helpers

On a recipe page:
- **Servings stepper:** − / + rescales the ingredient quantities, and scaled amounts are highlighted.
  - When the yield isn't a number of servings (e.g. "1 loaf (10 slices)"), it becomes a ×½ … ×4 multiplier instead.
  - Only a quantity at the start of a line is scaled: `2`, `1.5`, `1 1/2`, `½`, `2-3`, `500g`, `1 x 400 g tin`. Lines like "Juice of 1 lemon" or "Salt, to taste" stay exactly as written.
  - **Measured amounts** (with a unit: g, ml, tbsp, cup…) keep their precision: `2⅔ tbsp`, `335 ml`.
  - **Counted items** round to something usable: the nearest ½ below 2, otherwise a whole number. "1 onion" × 8/6 → `1½ onion`, "2 carrots" → `3 carrots`.
- **Tick off** an ingredient or step by tapping it, or with Space when using a keyboard. "Clear ticks" resets them.
- **Servings and ticks last for the browser session.** They survive leaving the recipe and reloading, but not closing the tab.
- **Keep screen on** stops the phone or tablet from sleeping while the recipe is open (Screen Wake Lock API), and is released when you leave the recipe.
  - Browsers only offer this on **HTTPS or `localhost`**, so the button is hidden when the app is served over plain HTTP on your LAN. See [deploy/README.md](deploy/README.md#5-https-certificate) for HTTPS on the Pi.
- **Print** gives a clean one-page layout: ingredients beside the method, no buttons, a small image, nothing struck through. If you scaled the recipe, it prints the scaled quantities with a note ("Quantities scaled to 8 servings.").

## Usage

### Local development

```bash
node tools/build-index.mjs samples/recipes --report
```

`build-index.mjs` options:

| Option | Effect |
|---|---|
| `--report` | Print counts per category value, recipes without a time, and recipes with inferred or uncategorised facets |
| `--strict` | Exit with status 1 if there are any warnings (used in CI) |
| `--dry-run` | Don't write `index.json` |
| `--out <file>` | Write the index somewhere other than `<recipes-dir>/index.json` |
| `--if-changed` | Only write when recipes changed (ignoring the timestamp); used by the Pi's timer |

Warnings are printed for invalid JSON, files without a Recipe, recipes with no name, ingredients or instructions, missing local images, duplicate ids (`x.json` + `x.jsonld`), and unknown category tags. Broken files are skipped and the rest are still indexed.

Run the app locally with the dev server:

```bash
npm install                                    # first time only: Playwright, used by tests and screenshots
npm run dev                                    # samples at http://localhost:8080/
node tools/dev-server.mjs --recipes ~/my-recipes
node tools/dev-server.mjs --base /recipes/     # mimic GitHub Pages' sub-path
node tools/dev-server.mjs --host 0.0.0.0       # reachable from your phone on the same network
```

The dev server rebuilds `recipes/index.json` in memory on every request, so new or edited recipe files show up when you reload. It never writes to your recipes folder.

### Tests

```bash
npm test                     # unit tests (node --test), no dependencies
npm run index:samples        # build the sample index; fails on any warning
npm run e2e                  # end-to-end tests on phone + tablet viewports (Playwright)
npm run screenshots          # phone/tablet × light/dark screenshots into screenshots/
```

Run `npx playwright install chromium` once before the first `npm run e2e` or `npm run screenshots`.

### Home network deployment (NAS + Raspberry Pi)

See **[deploy/README.md](deploy/README.md)** for the step-by-step guide. In short:
- **The Pi serves the app** from `/var/www/recipes`, copied there by `deploy/deploy.sh`.
- **Recipes are read directly from the NAS share** mounted on the Pi (`/mnt/chipolata/recipes/processed/`). Nothing is written there.
- **A systemd timer rebuilds** `/var/lib/recipes/index.json` every 5 minutes, but only rewrites it when recipes changed.
- **nginx maps `/recipes/…`** onto the NAS folder and the index, with HTTPS, gzip, caching and security headers (`deploy/nginx.conf.example`).

Updating later:

```bash
cd /opt/recipes && git pull && sudo deploy/deploy.sh
```

### GitHub Pages

Pushing to `main` runs `.github/workflows/pages.yml`. It copies `site/`, copies `samples/recipes/` into `recipes/`, builds the index and deploys. Enable it once under **Settings → Pages → Source: GitHub Actions**. You can also run it by hand from the **Actions** tab. The demo is at `https://<user>.github.io/recipes/`.

---

## Roadmap

| Phase | Deliverable | Requirements |
|---|---|---|
| 0 ✅ | README, CLAUDE.md, repo skeleton, CI | — |
| 1 ✅ | JSON-LD normalizer, taxonomy and inference, index builder with `--report`, 15–20 CC0 sample recipes, unit tests | R1–R4, R14–R17 |
| 2 ✅ | Mobile-first app shell, hash router, recipe list with badges, recipe view, GitHub Pages deploy | R5, R9, N1–N5 |
| 3 ✅ | Search, category filters (bottom sheet), time filter and sort, ingredient filter | R6–R8, R18, R19, N6 |
| 4 ✅ | Cooking helpers: scaler, check-off, wake lock, print | R10–R13 |
| 5 ✅ | Raspberry Pi deployment: deploy script, nginx config, index timer, HTTPS guide | — |
| Later | Favourites, shopping list, PWA/offline, validator CLI, import-from-URL CLI, ingredient exclusion, "what can I make?" pantry matching | — |

## Open questions
- Units: show recipes as written, or add metric/imperial conversion? (Currently: as written.)
- License for the app code (sample recipes are CC0).

## Licence
Sample recipes in `samples/recipes/` are original works dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). App code licence: TBD.

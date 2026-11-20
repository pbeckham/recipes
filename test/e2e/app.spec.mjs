import { test, expect } from '@playwright/test';

// Fail any test that logs a console error or throws, unless the test
// expects one (failed fetches are logged by the browser as console errors).
const consoleErrors = new WeakMap();
const expectConsoleErrors = (page) => consoleErrors.get(page).splice(0);

test.beforeEach(async ({ page }) => {
  const errors = [];
  consoleErrors.set(page, errors);
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
});

test.afterEach(async ({ page }) => {
  expect(consoleErrors.get(page), 'console errors').toEqual([]);
});

async function noHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'horizontal overflow (px)').toBeLessThanOrEqual(0);
}

test('home lists every sample recipe with badges and times', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: 'All recipes' })).toBeVisible();
  await expect(page.getByText('19 recipes')).toBeVisible();
  const cards = page.locator('.card');
  await expect(cards).toHaveCount(19);

  const ragu = cards.filter({ hasText: 'Slow-Cooked Beef Ragù' });
  await expect(ragu.locator('.badge')).toHaveText(['Meal: Main', 'Protein: Beef', 'Carb: Pasta']);
  await expect(ragu.locator('.card-meta')).toContainText('3 hr 20 min');

  // Untagged recipe: inferred badges are marked.
  const pesto = cards.filter({ hasText: 'Basil Pesto' });
  await expect(pesto.locator('.badge-inferred')).toHaveCount(3);
  await expect(pesto.locator('.card-meta')).toHaveCount(0); // no time known

  await expect(page).toHaveTitle('Recipes');
  await noHorizontalScroll(page);
});

test('cards show images, with a placeholder when there is none', async ({ page }) => {
  await page.goto('./');
  const bread = page.locator('.card', { hasText: 'Banana Bread' });
  const img = bread.locator('img.card-media');
  await expect(img).toHaveAttribute('src', 'recipes/baking/banana-bread.svg');
  await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.card', { hasText: 'Lemon Posset' }).locator('.media-placeholder')).toHaveCount(1);
});

test('opening a recipe shows ingredients and sectioned method, back returns to the list', async ({ page }) => {
  await page.goto('./');
  await page.locator('.card', { hasText: 'Slow-Cooked Beef Ragù' }).click();
  await expect(page).toHaveURL(/#\/recipe\/mains\/slow-cooked-beef-ragu$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Slow-Cooked Beef Ragù with Pappardelle');
  await expect(page).toHaveTitle('Slow-Cooked Beef Ragù with Pappardelle · Recipes');

  await expect(page.locator('.ingredient-list li')).toHaveCount(12);
  await expect(page.locator('.method-section h3')).toHaveText(['For the ragù', 'To serve']);
  await expect(page.locator('.step-list li')).toHaveCount(6);
  await expect(page.locator('.fact')).toHaveText(['Prep20 min', 'Cook3 hr', 'Total3 hr 20 min', 'Makes6 servings']);
  await noHorizontalScroll(page);

  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'All recipes' })).toBeVisible();
  await expect(page).toHaveURL(/#?\/?$/);
});

/** Top of a card relative to the viewport, rounded. */
const cardTop = (locator) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().top));

test('returning to the list puts the same card back in the same place', async ({ page }) => {
  await page.goto('./');
  const target = page.locator('.card', { hasText: 'Venison' });
  await target.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const top = await cardTop(target);
  await target.click();
  await expect(page.locator('.ingredient-list')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.card-list')).toBeVisible();
  await expect.poll(async () => Math.abs((await cardTop(target)) - top), 'card moved (px)').toBeLessThanOrEqual(1);
});

test('deep links work for every JSON-LD shape in the samples', async ({ page }) => {
  const cases = [
    ['soups/chicken-noodle-soup', 'Ginger Chicken Noodle Soup', 3], // @graph, HowToStep with names
    ['salads/warm-potato-bacon-salad', 'Warm Potato & Bacon Salad', 5], // numbered string instructions
    ['sauces/basil-pesto', 'Basil Pesto', 4], // newline string, no times
    ['drinks/ginger-lemonade', 'Fresh Ginger Lemonade', 3], // .jsonld
    ['mains/chicken-chorizo-rice', 'Chicken & Chorizo Rice', 4], // @type array
    ['baking/banana-bread', 'Brown Butter Banana Bread', 5], // sections with plain strings
  ];
  for (const [id, name, steps] of cases) {
    await page.goto(`./#/recipe/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    await expect(page.locator('.step-list li')).toHaveCount(steps);
  }
});

test('recipe page details: description entities, inferred note, nutrition', async ({ page }) => {
  await page.goto('./#/recipe/starters/prawn-cocktail-lettuce-cups');
  await expect(page.locator('.recipe-description')).toContainText('15 minutes & no cooking');
  await page.getByText('Nutrition').click();
  await expect(page.locator('.nutrition dl')).toContainText('Calories160 kcal');

  await page.goto('./#/recipe/soups/roast-tomato-soup');
  await expect(page.getByText('Dashed categories were guessed')).toBeVisible();
  await expect(page.locator('img.recipe-media')).toHaveAttribute('src', 'recipes/soups/roast-tomato-soup.svg');
});

test('unknown recipes and routes show a not-found page', async ({ page }) => {
  await page.goto('./#/recipe/does/not-exist');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recipe not found');
  await page.getByRole('link', { name: 'See all recipes' }).click();
  await expect(page.locator('.card')).toHaveCount(19);

  await page.goto('./#/nonsense');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
});

test('a missing index shows setup instructions', async ({ page }) => {
  await page.route('**/recipes/index.json', (route) => route.fulfill({ status: 404, body: 'nope' }));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No recipe index found');
  await expect(page.locator('pre')).toContainText('build-index.mjs');
  expectConsoleErrors(page);
});

test('a recipe file that fails to load shows an error but keeps the header', async ({ page }) => {
  await page.route('**/recipes/desserts/lemon-posset.json', (route) => route.fulfill({ status: 500, body: '' }));
  await page.goto('./#/recipe/desserts/lemon-posset');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lemon Posset');
  await expect(page.getByRole('alert')).toContainText('HTTP 500');
  expectConsoleErrors(page);
});

test('recipe text is never interpreted as HTML', async ({ page }) => {
  const evil = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Evil &lt;img src=x onerror="window.pwned=1"&gt;',
    description: '<img src=x onerror="window.pwned=1">',
    recipeIngredient: ['&lt;script&gt;window.pwned=1&lt;/script&gt;'],
    recipeInstructions: 'Step &lt;b onclick=x&gt;one&lt;/b&gt;',
    url: 'javascript:window.pwned=1',
  };
  await page.route('**/recipes/index.json', async (route) => {
    const res = await route.fetch();
    const index = await res.json();
    index.recipes.unshift({ ...index.recipes[0], id: 'evil', file: 'evil.json', name: evil.name.replace(/&lt;/g, '<').replace(/&gt;/g, '>') });
    await route.fulfill({ json: index });
  });
  await page.route('**/recipes/evil.json', (route) => route.fulfill({ json: evil }));
  await page.goto('./#/recipe/evil');
  await expect(page.locator('.ingredient-list li')).toHaveText('<script>window.pwned=1</script>');
  await expect(page.locator('h1')).toContainText('<img src=x');
  await expect(page.locator('.recipe img[src="x"]')).toHaveCount(0);
  await expect(page.locator('.source-link')).toHaveCount(0);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
});

test('large collections render in batches while scrolling and keep their place on back', async ({ page }) => {
  // 19 samples × 8 = 152 recipes, enough for several batches.
  await page.route('**/recipes/index.json', async (route) => {
    const index = await (await route.fetch()).json();
    const base = index.recipes;
    index.recipes = Array.from({ length: 8 }, (_, i) => base.map((r) => ({ ...r, id: `${r.id}-${i}`, name: `${r.name} ${String(i).padStart(2, '0')}` }))).flat();
    await route.fulfill({ json: index });
  });
  await page.goto('./');
  await expect(page.getByText('152 recipes')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(48);

  // Scroll until everything is rendered.
  await expect(async () => {
    await page.mouse.wheel(0, 5000);
    await expect(page.locator('.card')).toHaveCount(152, { timeout: 200 });
  }).toPass({ timeout: 10_000 });
  await expect(page.locator('.list-sentinel')).toHaveCount(0);

  // Wheel scrolling is animated: jump to the bottom and wait until the page
  // is still before measuring.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  const last = page.locator('.card').last();
  let top = await cardTop(last);
  await expect(async () => {
    const prev = top;
    await page.waitForTimeout(100);
    top = await cardTop(last);
    expect(top).toBe(prev);
  }).toPass();
  await last.click();
  await expect(page.locator('.ingredient-list')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.card')).toHaveCount(152);
  await expect.poll(async () => Math.abs((await cardTop(last)) - top), 'card moved (px)').toBeLessThanOrEqual(1);
});

import { test, expect } from '@playwright/test';

// Phase 3: search, filters, sort and URL state (R6–R8, R18, R19).

const consoleErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  consoleErrors.set(page, errors);
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(async ({ page }) => {
  expect(consoleErrors.get(page), 'console errors').toEqual([]);
});

const titles = (page) => page.locator('.card-title');
const count = (page) => page.locator('.result-count');
const hashQuery = (page) => new URL(page.url()).hash.replace(/^#\/\??/, '');

async function openFilters(page) {
  await page.getByRole('button', { name: /^Filters/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('typing searches name, ingredients and tags; URL keeps the query', async ({ page }) => {
  await page.goto('./');
  const search = page.getByRole('searchbox', { name: 'Search recipes' });
  await search.fill('chick');
  await expect(count(page)).toHaveText(/^\d+ of 19 recipes$/);
  await expect(titles(page).first()).toContainText('Chicken');
  expect(hashQuery(page)).toBe('q=chick');
  await expect(page.locator('#sort')).toHaveValue('relevance');

  await search.fill('pappardelle');
  await expect(titles(page)).toHaveText(['Slow-Cooked Beef Ragù with Pappardelle']);

  await search.fill('zzz');
  await expect(page.getByText('No recipes match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(count(page)).toHaveText('19 recipes');
  await expect(search).toHaveValue('');
});

test('category filters: OR within a facet, AND across, with live counts', async ({ page }) => {
  await page.goto('./');
  const sheet = await openFilters(page);
  const meal = sheet.getByRole('group', { name: 'Meal' });
  await meal.getByText('Soup', { exact: true }).click();
  await meal.getByText('Salad', { exact: true }).click();
  await expect(count(page)).toHaveText('4 of 19 recipes');
  await expect(sheet.getByRole('button', { name: 'Show 4 recipes' })).toBeVisible();

  // AND across facets; options with no matches are disabled.
  const protein = sheet.getByRole('group', { name: 'Protein' });
  await expect(protein.getByRole('checkbox', { name: /Beef/ })).toBeDisabled();
  await protein.getByText('Poultry', { exact: true }).click();
  await expect(count(page)).toHaveText('1 of 19 recipes');

  await sheet.getByRole('button', { name: 'Show 1 recipe' }).click();
  await expect(sheet).toBeHidden();
  await expect(titles(page)).toHaveText(['Ginger Chicken Noodle Soup']);
  await expect(page.getByRole('button', { name: 'Filters, 3 active' })).toBeVisible();
  expect(hashQuery(page)).toBe('meal=Soup&meal=Salad&protein=Poultry');

  // Chips remove single filters; Clear all removes the rest.
  await page.getByRole('button', { name: 'Remove filter: Poultry' }).click();
  await expect(count(page)).toHaveText('4 of 19 recipes');
  await page.locator('.chip-row').getByRole('button', { name: 'Clear all' }).click();
  await expect(count(page)).toHaveText('19 recipes');
  expect(hashQuery(page)).toBe('');
});

test('time filter hides slower recipes and those without a time; sort by time', async ({ page }) => {
  await page.goto('./');
  const sheet = await openFilters(page);
  await sheet.getByText('≤ 15 min').click();
  await sheet.getByRole('button', { name: /^Show/ }).click();
  await expect(count(page)).toContainText('· 1 without a time hidden');
  const n = await titles(page).count();
  expect(n).toBeGreaterThan(0);
  for (const t of await page.locator('.card-meta').allInnerTexts()) {
    expect(Number(t.match(/(\d+) min/)[1])).toBeLessThanOrEqual(15);
  }

  await page.locator('.chip-row').getByRole('button', { name: 'Clear all' }).click();
  await page.locator('#sort').selectOption('time');
  await expect(titles(page).first()).toHaveText('Garlicky Green Beans with Almonds');
  await expect(titles(page).last()).toHaveText('Basil Pesto'); // no time → last
  expect(hashQuery(page)).toBe('sort=time');
});

test('ingredient filter: suggestions, must include all, removable', async ({ page }) => {
  await page.goto('./');
  const sheet = await openFilters(page);
  const input = sheet.getByRole('textbox', { name: 'Add an ingredient' });
  await input.fill('chori');
  await sheet.getByRole('button', { name: /^Add chorizo/ }).click();
  await expect(count(page)).toHaveText('1 of 19 recipes');
  await expect(input).toBeFocused();

  // Typed term + Enter; "tomato" also matches "tomatoes".
  await sheet.getByRole('button', { name: 'Remove chorizo' }).click();
  await input.fill('tomato');
  await input.press('Enter');
  await expect(sheet.getByRole('button', { name: 'Remove tomato' })).toBeVisible();
  const withTomato = await count(page).innerText();
  await input.fill('garlic');
  await input.press('Enter');
  await expect(count(page)).not.toHaveText(withTomato); // AND narrows
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: 'Remove filter: must include tomato' })).toBeVisible();
  expect(hashQuery(page)).toBe('ing=tomato&ing=garlic');
});

test('filtered URLs are shareable and survive opening a recipe and coming back', async ({ page }) => {
  await page.goto('./#/?meal=Main&carb=Rice&carb=Pasta&sort=time');
  await expect(titles(page)).toHaveText(['Chicken & Chorizo Rice', 'Slow-Cooked Beef Ragù with Pappardelle']);
  await expect(page.getByRole('button', { name: 'Filters, 3 active' })).toBeVisible();
  await expect(page.locator('#sort')).toHaveValue('time');

  await titles(page).first().click();
  await expect(page.locator('.ingredient-list')).toBeVisible();
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(titles(page)).toHaveCount(2);
  expect(hashQuery(page)).toBe('meal=Main&carb=Rice&carb=Pasta&sort=time');
});

test('invalid URL values are ignored', async ({ page }) => {
  await page.goto('./#/?meal=Nope&time=7&sort=bogus&q=');
  await expect(count(page)).toHaveText('19 recipes');
  await expect(page.locator('.chip-row')).toBeHidden();
});

test('filter sheet is keyboard accessible and returns focus', async ({ page }) => {
  await page.goto('./');
  const button = page.getByRole('button', { name: /^Filters/ });
  await button.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(sheet.locator(':focus')).toHaveCount(1); // focus stays inside the modal
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(button).toBeFocused();
});

test('phone: filter sheet is a bottom sheet with no horizontal overflow', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  await page.goto('./#/?meal=Main&meal=Soup&protein=Poultry&time=60&ing=garlic');
  const sheet = await openFilters(page);
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))); // slide-up done
  const box = await sheet.boundingBox();
  const vh = page.viewportSize().height;
  expect(Math.round(box.y + box.height)).toBe(vh);
  expect(box.width).toBe(page.viewportSize().width);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

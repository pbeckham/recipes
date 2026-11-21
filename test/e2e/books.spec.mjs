import { test, expect } from '@playwright/test';

// Cookbooks: book on recipe pages, Book filter, Books progress page.

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

test('Books page shows progress and what is still missing', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'Books' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Books' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Books' })).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle('Books · Recipes');

  const kitchen = page.locator('.book-card', { hasText: 'The Sample Kitchen' });
  await expect(kitchen).toContainText('4 of 6 recipes in the collection · 67%');
  await expect(kitchen.getByRole('progressbar')).toHaveAttribute('value', '4');
  await kitchen.getByText('2 still to add').click();
  await expect(kitchen.locator('.missing-list li')).toHaveText(['p. 46Smoky Three-Bean Chilli', 'p. 92Rhubarb & Ginger Fool']);

  const weekend = page.locator('.book-card', { hasText: 'Weekend Cooking' });
  await expect(weekend).toContainText('1 recipe · no contents list');
  await expect(page.getByText('14 recipes not linked to a book.')).toBeVisible();

  await kitchen.getByRole('link', { name: 'Show recipes' }).click();
  await expect(page.locator('.result-count')).toHaveText('4 of 19 recipes');
  await expect(page.getByRole('button', { name: 'Remove filter: book The Sample Kitchen' })).toBeVisible();
});

test('recipe pages say which book and page, and link to the rest of the book', async ({ page }) => {
  await page.goto('./#/recipe/breakfast/shakshuka');
  await expect(page.locator('.recipe-book')).toHaveText('From The Sample Kitchen, p. 12');
  await page.goto('./#/recipe/soups/roast-tomato-soup');
  await expect(page.locator('.recipe-book')).toHaveText('From The Sample Kitchen, p. 24 (matched by title)');
  await page.locator('.recipe-book a').click();
  await expect(page.locator('.result-count')).toHaveText('4 of 19 recipes');
  await page.goto('./#/recipe/egg-fried-rice');
  await expect(page.locator('.recipe-book')).toHaveCount(0);
});

test('Book filter in the sheet, combined with other filters', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /^Filters/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  const book = sheet.getByRole('group', { name: 'Book' });
  await expect(book.locator('.option')).toHaveText(['The Sample Kitchen4', 'Weekend Cooking1']);
  await book.getByText('Weekend Cooking').click();
  await book.getByText('The Sample Kitchen').click();
  await expect(page.locator('.result-count')).toHaveText('5 of 19 recipes');
  await sheet.getByRole('group', { name: 'Meal' }).getByText('Breakfast', { exact: true }).click();
  await expect(page.locator('.result-count')).toHaveText('2 of 19 recipes');
});

test('back from the Books page returns to the list', async ({ page }) => {
  await page.goto('./#/?meal=Soup');
  await page.getByRole('link', { name: 'Books' }).click();
  await expect(page.locator('.book-card').first()).toBeVisible();
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(page.locator('.result-count')).toHaveText('2 of 19 recipes');
});

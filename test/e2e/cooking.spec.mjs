import { test, expect } from '@playwright/test';

// Phase 4: serving scaler, tick-off, keep screen on, print (R10–R13).

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

const RAGU = './#/recipe/mains/slow-cooked-beef-ragu';
const ingredients = (page) => page.locator('.ingredient .tick-text');

/** Replace the Screen Wake Lock API with a recording fake. */
async function fakeWakeLock(page) {
  await page.addInitScript(() => {
    window.__wake = { requests: 0, releases: 0 };
    const wakeLock = {
      request: async () => {
        window.__wake.requests += 1;
        const listeners = [];
        return {
          released: false,
          addEventListener: (_t, fn) => listeners.push(fn),
          release: async function () {
            this.released = true;
            window.__wake.releases += 1;
            listeners.forEach((fn) => fn());
          },
        };
      },
    };
    Object.defineProperty(navigator, 'wakeLock', { value: wakeLock, configurable: true });
  });
}

test('servings stepper scales quantities and resets', async ({ page }) => {
  await page.goto(RAGU);
  const servings = page.getByRole('group', { name: 'Servings' });
  await expect(servings.locator('output')).toHaveText('6 servings');
  await expect(ingredients(page).first()).toHaveText('2 tbsp olive oil');

  await servings.getByRole('button', { name: 'More servings' }).click();
  await servings.getByRole('button', { name: 'More servings' }).click();
  await expect(servings.locator('output')).toHaveText('8 servings');
  await expect(ingredients(page).nth(0)).toHaveText('2⅔ tbsp olive oil'); // measured: precise
  await expect(ingredients(page).nth(2)).toHaveText('1½ onion, finely chopped'); // counted: rounded
  await expect(ingredients(page).nth(10)).toHaveText('665 g pappardelle');
  await expect(ingredients(page).nth(11)).toHaveText('Grated parmesan, to serve'); // no quantity
  await expect(page.locator('.qty-scaled').first()).toHaveText('2⅔');

  await servings.getByRole('button', { name: 'Reset' }).click();
  await expect(servings.locator('output')).toHaveText('6 servings');
  await expect(ingredients(page).nth(10)).toHaveText('500 g pappardelle');
  await expect(servings.getByRole('button', { name: 'Reset' })).toBeHidden();

  // Lower bound.
  for (let i = 0; i < 5; i++) await servings.getByRole('button', { name: 'Fewer servings' }).click();
  await expect(servings.locator('output')).toHaveText('1 serving');
  await expect(servings.getByRole('button', { name: 'Fewer servings' })).toBeDisabled();
});

test('recipes whose yield is not servings get a multiplier', async ({ page }) => {
  await page.goto('./#/recipe/baking/banana-bread');
  const qty = page.getByRole('group', { name: 'Recipe quantity' });
  await expect(qty.locator('output')).toHaveText('×1');
  await expect(qty).toContainText('makes 1 loaf (10 slices)');
  await qty.getByRole('button', { name: 'Larger quantity' }).click();
  await expect(qty.locator('output')).toHaveText('×1½');
  await expect(ingredients(page).first()).toHaveText('150 g unsalted butter, plus extra for the tin');
  await expect(ingredients(page).nth(1)).toHaveText('5 very ripe bananas'); // 4.5 → whole
});

test('ingredients and steps tick off, by touch or keyboard, and can be cleared', async ({ page }) => {
  await page.goto(RAGU);
  const first = page.locator('.ingredient').first();
  await first.click();
  await expect(first.getByRole('checkbox')).toBeChecked();
  await expect(first.locator('.tick-text')).toHaveCSS('text-decoration-line', 'line-through');

  const step = page.locator('.step').first();
  await step.getByRole('checkbox').focus();
  await page.keyboard.press('Space');
  await expect(step.getByRole('checkbox')).toBeChecked();
  await expect(page.locator('.step-marker').first()).toHaveCSS('background-color', /.+/);

  await page.getByRole('button', { name: 'Clear ticks' }).click();
  await expect(page.locator('.tick-input:checked')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear ticks' })).toBeHidden();
});

test('servings and ticks last for the session, not beyond it', async ({ page, browser }) => {
  await page.goto(RAGU);
  await page.getByRole('button', { name: 'More servings' }).click();
  await page.locator('.ingredient').nth(3).click();

  // Leave and come back.
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(page.locator('.card').first()).toBeVisible();
  await page.goto(RAGU);
  await expect(page.locator('.stepper output')).toHaveText('7 servings');
  await expect(page.locator('.ingredient').nth(3).getByRole('checkbox')).toBeChecked();

  // Reload keeps it (same tab session)…
  await page.reload();
  await expect(page.locator('.stepper output')).toHaveText('7 servings');

  // …a new session starts fresh.
  const other = await browser.newPage();
  await other.goto(new URL(RAGU, page.url()).href);
  await expect(other.locator('.stepper output')).toHaveText('6 servings');
  await expect(other.locator('.tick-input:checked')).toHaveCount(0);
  await other.close();
});

test('keep screen on: acquires the wake lock and releases it when leaving', async ({ page }) => {
  await fakeWakeLock(page);
  await page.goto(RAGU);
  const toggle = page.getByRole('button', { name: 'Keep screen on' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__wake.requests)).toBe(1);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__wake.releases)).toBe(1);

  await toggle.click();
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(page.locator('.card').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__wake.releases)).toBe(2);
});

test('keep screen on is hidden where the browser has no Wake Lock API', async ({ page }) => {
  await page.addInitScript(() => {
    delete Navigator.prototype.wakeLock;
  });
  await page.goto(RAGU);
  await expect(page.locator('.cook-tools')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep screen on' })).toHaveCount(0);
});

test('print button prints; print layout hides controls and notes scaling', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      window.__printed = true;
    };
  });
  await page.goto(RAGU);
  await page.getByRole('button', { name: 'More servings' }).click();
  await page.locator('.ingredient').first().click();
  await page.getByRole('button', { name: 'Print' }).click();
  expect(await page.evaluate(() => window.__printed)).toBe(true);

  await expect(page.locator('.scale-note')).toBeHidden(); // screen
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.app-bar')).toBeHidden();
  await expect(page.locator('.cook-tools')).toBeHidden();
  await expect(page.locator('.scale-note')).toHaveText('Quantities scaled to 7 servings.');
  await expect(page.locator('.ingredient-list')).toBeVisible();
  // Ticked lines print normally.
  await expect(page.locator('.ingredient .tick-text').first()).toHaveCSS('text-decoration-line', 'none');
  // Ingredients and method side by side on paper.
  const ing = await page.locator('.ingredients').boundingBox();
  const method = await page.locator('.method').boundingBox();
  expect(method.x).toBeGreaterThan(ing.x + ing.width - 1);
});

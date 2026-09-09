// M00 smoke test: the page served by tools/serve.js boots src/main.js cleanly.
import { test, expect } from '@playwright/test';

test('the page loads with no console errors and installs window.CH @unit @m00', async ({ page }) => {
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()}`));

  const response = await page.goto('/index.html');
  expect(response?.status()).toBe(200);

  await expect(page.locator('canvas#game')).toHaveCount(1);
  await expect(page.locator('input#seed')).toHaveCount(1);
  await expect(page.locator('input#seed')).toBeHidden();

  await page.waitForFunction(() => typeof window.CH === 'object' && window.CH !== null);
  expect(await page.evaluate(() => typeof window.CH)).toBe('object');

  // The stub renderer must have painted something onto the canvas.
  const painted = await page.evaluate(() => {
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return seen.size;
  });
  expect(painted).toBeGreaterThan(1);

  expect(problems).toEqual([]);
});

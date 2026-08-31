import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const downloadUrl =
  'https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v0.1.0/GlideLingo-0.1.0-universal.dmg';
const checksumUrl = `${downloadUrl}.sha256`;

test('renders the complete landing page without third-party requests or horizontal overflow', async ({ page }) => {
  /** @type {string[]} */
  const unexpectedRequests = [];
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== 'http://127.0.0.1:4322') {
      unexpectedRequests.push(request.url());
    }
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Build a language habit that feels clear.');
  await expect(page.getByRole('heading', { name: 'Everything you need to make steady progress.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your next lesson, ready on Mac.' })).toBeVisible();
  await expect(page.locator('[data-download-state="available"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download GlideLingo 0.1.0 for Mac' }).last()).toHaveAttribute(
    'href',
    downloadUrl,
  );
  await expect(page.getByRole('link', { name: 'View SHA-256 checksum' })).toHaveAttribute('href', checksumUrl);

  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
  expect(unexpectedRequests).toEqual([]);
  expect(await page.context().cookies()).toEqual([]);
});

test('supports keyboard navigation and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});

test('has no automatically detectable accessibility violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('renders a branded, non-indexed 404 page', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page.getByRole('heading', { name: 'This page flew off course.' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.getByRole('link', { name: 'Return home' })).toHaveAttribute('href', '/');
});

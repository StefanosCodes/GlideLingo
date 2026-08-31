import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { resolvePlaywrightServerConfig } from '../scripts/playwright-server-config.mjs';

const downloadUrl =
  'https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v0.1.0/GlideLingo-0.1.0-universal.dmg';
const checksumUrl =
  'https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v0.1.0/SHA256SUMS.txt';
const { origin: testOrigin } = resolvePlaywrightServerConfig();

test('renders the complete landing page without third-party requests or horizontal overflow', async ({ page }) => {
  /** @type {string[]} */
  const unexpectedRequests = [];
  /** @type {string[]} */
  const consoleErrors = [];
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== testOrigin) {
      unexpectedRequests.push(request.url());
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Language learning, redesigned.');
  await expect(page.getByRole('heading', { name: 'See the learning rhythm in motion.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Take GlideLingo with you.' })).toBeVisible();
  await expect(page.locator('.site-header .brand-symbol')).toHaveAttribute('src', '/brand/glidelingo-bird-black.svg');
  await expect(page.locator('.site-header .brand-name')).toHaveText('GlideLingo');
  await expect(page.locator('.site-header').getByText('Download for Mac')).toHaveCount(0);
  await expect(page.locator('[data-video-state="awaiting-source"]')).toBeVisible();
  await expect(page.getByLabel('Product demonstration video coming soon')).toBeVisible();
  await expect(page.locator('.download-lockup .brand-name')).toHaveText('GlideLingo');
  await expect(page.locator('.download-section')).toHaveCSS('background-color', 'rgb(11, 16, 32)');
  await expect(page.locator('[data-download-state="available"]')).toBeVisible();
  await expect(page.locator('[data-platform-state="coming-soon"]')).toContainText('Windows coming soon');
  await expect(page.getByRole('link', { name: 'Download GlideLingo 0.1.0 for Mac' }).last()).toHaveAttribute(
    'href',
    downloadUrl,
  );
  await expect(page.getByRole('link', { name: 'View SHA-256 checksum' })).toHaveAttribute('href', checksumUrl);

  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  const typography = await page.evaluate(async () => {
    await document.fonts.ready;
    const heading = document.querySelector('h1');
    return {
      displayFontLoaded: document.fonts.check('48px Satoshi'),
      headingFamily: heading ? getComputedStyle(heading).fontFamily : '',
    };
  });
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
  expect(typography.displayFontLoaded).toBe(true);
  expect(typography.headingFamily).toContain('Satoshi');
  expect(unexpectedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(await page.context().cookies()).toEqual([]);
});

test('supports keyboard navigation and reduced motion', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
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
  await expect(page.getByRole('link', { name: 'GlideLingo home' })).toContainText('GlideLingo');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.getByRole('link', { name: 'Return home' })).toHaveAttribute('href', '/');
});

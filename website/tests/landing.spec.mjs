import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { resolvePlaywrightServerConfig } from '../scripts/playwright-server-config.mjs';

const downloadUrl =
  'https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v0.1.0/GlideLingo-0.1.0-universal.dmg';
const { origin: testOrigin } = resolvePlaywrightServerConfig();

test('renders the complete landing page without third-party requests or horizontal overflow', async ({
  page,
  browserName,
}) => {
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

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learn the language. Enter the world.');
  await expect(page.locator('.hero-lede')).toHaveText(
    'Build the skills and confidence to stop practicing from the sidelines and start joining real conversations.',
  );
  await expect(page.getByRole('heading', { name: 'See the learning rhythm in motion.' })).toBeVisible();
  await expect(page.locator('.site-header .brand-symbol')).toHaveAttribute('src', '/brand/glidelingo-bird-black.svg');
  await expect(page.locator('.site-header .brand-name')).toHaveText('GlideLingo');
  await expect(page.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '#pricing');
  await expect(page.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '#demo');
  const headerAlignment = await page.evaluate(() => {
    const header = document.querySelector('.header-inner');
    const navigation = document.querySelector('.site-nav');
    if (!header || !navigation) return null;
    const headerBox = header.getBoundingClientRect();
    const navigationBox = navigation.getBoundingClientRect();
    return Math.abs(
      navigationBox.left + navigationBox.width / 2 - (headerBox.left + headerBox.width / 2),
    );
  });
  expect(headerAlignment).not.toBeNull();
  expect(headerAlignment).toBeLessThanOrEqual(1);
  await expect(page.locator('main > section')).toHaveCount(3);
  await expect(page.locator('[data-video-state="ready"]')).toBeVisible();
  await expect(page.locator('.demo-intro').getByText('How it works', { exact: true })).toBeVisible();
  const productVideo = page.getByLabel('GlideLingo product walkthrough');
  await expect(productVideo).toHaveAttribute('controls', '');
  await expect(productVideo).toHaveAttribute('data-autoplay-when-visible', 'true');
  await expect(productVideo).toHaveAttribute('loop', '');
  await expect(productVideo).toHaveAttribute('muted', '');
  await expect(productVideo).toHaveAttribute('poster', '/images/product-home.png');
  await expect(page.locator('.demo-player source[type="video/webm"]')).toHaveAttribute(
    'src',
    '/videos/glidelingo-product-walkthrough.webm',
  );
  await expect(page.locator('.demo-player source[type="video/mp4"]')).toHaveAttribute(
    'src',
    '/videos/glidelingo-product-walkthrough.mp4',
  );
  await expect(page.locator('.demo-player track[kind="captions"]')).toHaveAttribute(
    'src',
    '/videos/glidelingo-product-walkthrough.vtt',
  );
  await expect(page.getByLabel('Product walkthrough video coming soon')).toHaveCount(0);
  await productVideo.scrollIntoViewIfNeeded();
  if (browserName === 'webkit') {
    await expect
      .poll(() => productVideo.evaluate((video) => /** @type {HTMLVideoElement} */ (video).readyState))
      .toBeGreaterThanOrEqual(1);
  } else {
    await expect
      .poll(
        () => productVideo.evaluate((video) => /** @type {HTMLVideoElement} */ (video).currentTime),
        { message: 'product video should autoplay' },
      )
      .toBeGreaterThan(0);
  }
  await expect(page.locator('.download-section')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Desktop apps');
  await expect(page.locator('.hero-actions .button-platform-icon')).toHaveCount(1);
  await expect(page.locator('.hero-actions .button-apple-icon')).toHaveCount(1);
  await expect(page.locator('.hero-actions')).toContainText('Download');
  await expect(page.locator('.hero-actions')).not.toContainText('Download for Mac');
  await expect(page.locator('.hero-actions[data-download-state="available"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download GlideLingo 0.1.0 for Mac' })).toHaveAttribute(
    'href',
    downloadUrl,
  );
  await expect(page.getByRole('heading', { name: 'Free', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toBeVisible();
  await expect(page.locator('.pricing-intro > p:last-child')).toHaveText(
    'Choose the plan that fits where you are. Upgrade whenever.',
  );
  await expect(page.locator('#pricing')).toContainText('$0');
  await expect(page.locator('#pricing')).toContainText('$19.99');
  await expect(page.locator('#pricing')).toContainText('Billed monthly. Cancel anytime.');

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
  if ((page.viewportSize()?.width ?? 0) > 860) {
    const ledeMetrics = await page.locator('.hero-lede').evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }));
    expect(ledeMetrics.height).toBeLessThanOrEqual(ledeMetrics.lineHeight + 1);
  }
  await page.getByRole('link', { name: 'How it works' }).click();
  expect(new URL(page.url()).hash).toBe('#demo');
  await page.getByRole('link', { name: 'Pricing' }).click();
  expect(new URL(page.url()).hash).toBe('#pricing');
  expect(unexpectedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(await page.context().cookies()).toEqual([]);
});

test('supports keyboard navigation and reduced motion', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const productVideo = page.getByLabel('GlideLingo product walkthrough');
  await productVideo.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  expect(await productVideo.evaluate((video) => /** @type {HTMLVideoElement} */ (video).paused)).toBe(true);

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

test('publishes accessible privacy and terms pages linked from the homepage', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy/');
  await expect(page.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms/');

  await page.getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://glidelingo.com/privacy/',
  );
  await expect(page.getByRole('heading', { name: 'Google sign-in data' })).toBeVisible();
  await expect(page.getByText('GlideLingo does not sell personal information.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'stefanoscodes26@gmail.com' }).first()).toHaveAttribute(
    'href',
    'mailto:stefanoscodes26@gmail.com',
  );
  await expect(page.getByText(/scheduled for deletion after 30 days/)).toBeVisible();

  await page.getByRole('link', { name: 'Terms' }).click();
  await expect(page).toHaveURL(/\/terms\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://glidelingo.com/terms/',
  );
  await expect(page.getByRole('heading', { name: 'Subscriptions and billing' })).toBeVisible();
});

test('keeps legal pages accessible, cookie-free, and within the viewport', async ({ page }) => {
  for (const route of ['/privacy/', '/terms/']) {
    await page.goto(route);
    const sizes = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
  }
});

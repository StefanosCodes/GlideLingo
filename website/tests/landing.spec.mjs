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

  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learn a language. Speak with confidence.');
  await expect(page.locator('.hero-lede')).toHaveText(
    'GlideLingo is a complete language-learning platform built to take you from your first lesson to real conversation, and keep you progressing toward mastery.',
  );
  await expect(page.getByRole('heading', { name: 'See how speaking starts.' })).toBeVisible();
  await expect(page.locator('.demo-intro > p:last-child')).toHaveText(
    'See how GlideLingo moves you from guided learning to speaking practice and focused review.',
  );
  await expect(page.locator('.site-header .brand-symbol')).toHaveAttribute('src', '/brand/glidelingo-bird-black.svg');
  await expect(page.locator('.site-header .brand-name')).toHaveText('GlideLingo');
  const launchBanner = page.getByLabel('Product announcement');
  await expect(launchBanner).toContainText('GlideLingo for macOS is now available. 🎉');
  await expect(launchBanner.getByRole('link', { name: 'Download for macOS' })).toHaveAttribute(
    'href',
    downloadUrl,
  );
  await expect(page.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '#pricing');
  await expect(page.getByRole('link', { name: 'How it works', exact: true })).toHaveAttribute('href', '#demo');
  await expect(page.locator('.site-header').getByRole('link', { name: 'Download for macOS' })).toHaveAttribute(
    'href',
    downloadUrl,
  );
  await expect(page.locator('.site-header .button-apple-icon')).toHaveCount(1);
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
  await expect(page.locator('main > section')).toHaveCount(4);
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
  await expect(page.locator('.hero-actions[data-download-state="available"]')).toBeVisible();
  const heroPrimary = page.locator('.hero-actions').getByRole('link', { name: 'Download for macOS' });
  await expect(heroPrimary).toHaveAttribute(
    'href',
    downloadUrl,
  );
  await expect(page.locator('.hero-actions').getByRole('link', { name: 'See how it works' })).toHaveAttribute(
    'href',
    '#demo',
  );
  await expect(page.locator('.hero-meta')).toHaveText('Free to start · Universal for Apple silicon and Intel Macs');
  await expect(page.locator('.product-actions').getByRole('link', { name: 'Start speaking' })).toHaveAttribute(
    'href',
    downloadUrl,
  );
  await heroPrimary.hover();
  await expect(heroPrimary).toHaveCSS('background-color', 'rgb(11, 16, 32)');
  await heroPrimary.focus();
  expect(await heroPrimary.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
  const heroPrimaryBox = await heroPrimary.boundingBox();
  expect(heroPrimaryBox).not.toBeNull();
  if (heroPrimaryBox) {
    await page.mouse.move(heroPrimaryBox.x + heroPrimaryBox.width / 2, heroPrimaryBox.y + heroPrimaryBox.height / 2);
    await page.mouse.down();
    expect(await heroPrimary.evaluate((element) => getComputedStyle(element).transform)).not.toBe('none');
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
  await expect(page.getByRole('heading', { name: 'Starter', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Professional', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Start with Starter. Keep speaking with Professional.' }),
  ).toBeVisible();
  await expect(page.locator('.plan-name img')).toHaveCount(2);
  await expect(page.locator('.plan-name img').first()).toHaveAttribute('src', '/brand/glidelingo-bird-black.svg');
  await expect(page.getByText('For new learners', { exact: true })).toBeVisible();
  await expect(page.getByText('For committed learners', { exact: true })).toBeVisible();
  await expect(page.getByText('Weekly learning rhythm', { exact: true })).toBeVisible();
  await expect(page.getByText('Everything in Starter', { exact: true })).toBeVisible();
  await expect(page.locator('.plan-includes')).toHaveText(['What’s included', 'What’s included']);
  await expect(page.getByRole('link', { name: 'Start free' })).toHaveAttribute('href', downloadUrl);
  await expect(page.getByRole('link', { name: 'Go Professional' })).toHaveAttribute('href', downloadUrl);
  await expect(page.locator('.pricing-intro > p:last-child')).toHaveText(
    'Choose the plan that fits where you are. Upgrade whenever.',
  );
  await expect(page.locator('#pricing')).toContainText('$0');
  await expect(page.locator('#pricing')).toContainText('$19.99');
  await expect(page.locator('#pricing')).toContainText('Billed monthly. Cancel anytime.');
  const pricingGradient = await page
    .locator('.pricing')
    .evaluate((element) => getComputedStyle(element, '::before').backgroundImage);
  expect(pricingGradient).toContain('218, 209, 255');
  expect(pricingGradient).toContain('255, 226, 204');
  const pricingCardDimensions = await page.locator('.pricing-card').evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      return { height: box.height, minHeight: getComputedStyle(card).minHeight, width: box.width };
    }),
  );
  for (const dimensions of pricingCardDimensions) {
    expect(dimensions.height).toBeGreaterThan(dimensions.width);
    if ((page.viewportSize()?.width ?? 0) > 700) {
      expect(dimensions.minHeight).toBe('610px');
      expect(dimensions.width).toBeLessThanOrEqual(370);
    }
  }
  const pricingClosingSpacing = await page.locator('.plan-closing').evaluateAll((closings) =>
    closings.map((closing) => {
      const note = closing.querySelector('.plan-note')?.getBoundingClientRect();
      const cta = closing.querySelector('.plan-cta')?.getBoundingClientRect();
      return note && cta ? Math.round(cta.top - note.bottom) : 0;
    }),
  );
  expect(pricingClosingSpacing).toEqual([32, 32]);
  await expect(page.getByRole('heading', { name: 'Ready to speak a new language?' })).toBeVisible();
  await expect(page.locator('.final-cta-inner > p')).toHaveText(
    'Start learning, start speaking, and keep progressing toward real mastery.',
  );
  await expect(page.locator('.final-cta').getByRole('link', { name: 'Start speaking' })).toHaveAttribute(
    'href',
    downloadUrl,
  );
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
    'content',
    'The GlideLingo language-learning app home screen',
  );
  await expect(page.locator('body')).not.toContainText('Greek');

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
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('smooth');
  await page.locator('.hero-actions').getByRole('link', { name: 'See how it works' }).click();
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

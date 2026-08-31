import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { resolvePlaywrightServerConfig } from '../scripts/playwright-server-config.mjs';

const { origin: testOrigin } = resolvePlaywrightServerConfig();
const articlePath = '/blog/why-learning-words-isnt-enough/';

test('renders the blog index as a responsive, first-party editorial feed', async ({ page }) => {
  /** @type {string[]} */
  const unexpectedRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== testOrigin) unexpectedRequests.push(request.url());
  });

  await page.goto('/blog/');

  await expect(page.getByRole('heading', { level: 1, name: 'Blog' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Latest' })).toBeVisible();
  await expect(page.locator('.site-nav a[href="/blog/"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.site-nav a[href="/#pricing"]')).toHaveText('Pricing');
  await expect(page.locator('.site-nav a[href="/#demo"]')).toHaveText('How it works');

  const featuredPost = page.locator(`.featured-post[href="${articlePath}"]`);
  await expect(featuredPost).toBeVisible();
  await expect(featuredPost).toContainText('Why learning words isn’t the same as learning a language');
  await expect(featuredPost).toContainText('Learning');
  await expect(featuredPost).toContainText('August 31, 2026');
  await expect(featuredPost).toContainText('5 min read');
  await expect(featuredPost.locator('img')).toHaveAttribute(
    'src',
    '/images/blog/from-words-to-conversation.webp',
  );

  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
  expect(unexpectedRequests).toEqual([]);

  await featuredPost.click();
  expect(new URL(page.url()).pathname).toBe(articlePath);
});

test('renders the launch article with article metadata, structured copy, and accessible markup', async ({ page }) => {
  await page.goto(articlePath);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Why learning words isn’t the same as learning a language',
  );
  await expect(page.locator('.article-meta')).toContainText('Learning');
  await expect(page.locator('.article-meta')).toContainText('August 31, 2026');
  await expect(page.locator('.article-meta')).toContainText('5 min read');
  await expect(page.locator('.article-hero img')).toHaveAttribute(
    'alt',
    'Translucent blue and aqua fragments flowing together into one continuous ribbon',
  );
  await expect(page.getByRole('heading', { level: 2, name: 'Knowing is not yet using' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'The goal is participation' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://glidelingo.com${articlePath}`,
  );
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    'https://glidelingo.com/images/blog/from-words-to-conversation.webp',
  );

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { resolvePlaywrightServerConfig } from '../scripts/playwright-server-config.mjs';

const { origin: testOrigin } = resolvePlaywrightServerConfig();
const articlePath = '/blog/why-learning-words-isnt-enough/';
const recentArticlePath = '/blog/from-first-phrase-to-real-conversation/';

test('renders the blog index as a responsive, first-party editorial feed', async ({ page }) => {
  /** @type {string[]} */
  const unexpectedRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== testOrigin) unexpectedRequests.push(request.url());
  });

  await page.goto('/blog/');

  await expect(page.getByRole('heading', { level: 1, name: 'Recent' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'All stories' })).toBeVisible();
  await expect(page.locator('.blog-masthead')).toHaveCount(0);
  await expect(page.locator('.site-nav a[href="/blog/"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.site-nav a[href="/#pricing"]')).toHaveText('Pricing');
  await expect(page.locator('.site-nav a[href="/#demo"]')).toHaveText('How it works');

  const recentCards = page.locator('.recent-card');
  await expect(recentCards).toHaveCount(3);
  const recentPost = page.locator(`.recent-card[href="${recentArticlePath}"]`);
  await expect(recentPost).toBeVisible();
  await expect(recentPost).toContainText('From first phrase to real conversation');
  await expect(recentPost).toContainText('Speaking');
  await expect(recentPost).toContainText('September 1, 2026');
  await expect(recentPost.locator('img')).toHaveAttribute('src', '/images/blog/conversation-gradient.jpg');

  const storyCards = page.locator('[data-blog-card]');
  await expect(storyCards).toHaveCount(7);
  await expect(page.getByRole('button', { name: 'All 7' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Speaking 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Learning 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Product 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Company 1' })).toBeVisible();
  await expect(page.locator('[data-blog-count]')).toHaveText('7 stories');

  await page.getByRole('button', { name: 'Speaking 2' }).click();
  await expect(page.getByRole('button', { name: 'Speaking 2' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-blog-card]:visible')).toHaveCount(2);
  await expect(page.locator('[data-blog-count]')).toHaveText('2 stories');

  await page.getByRole('button', { name: 'Learning 3' }).click();
  await expect(page.locator('[data-blog-card]:visible')).toHaveCount(3);
  await expect(page.locator('[data-blog-count]')).toHaveText('3 stories');

  await page.getByRole('button', { name: 'All 7' }).click();
  await expect(page.locator('[data-blog-card]:visible')).toHaveCount(7);
  await expect(page.locator('.blog-closing').getByRole('link', { name: 'See how it works' })).toHaveAttribute(
    'href',
    '/#demo',
  );

  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
  expect(unexpectedRequests).toEqual([]);

  const accessibilityResults = await new AxeBuilder({ page }).analyze();
  expect(accessibilityResults.violations).toEqual([]);

  await recentPost.click();
  expect(new URL(page.url()).pathname).toBe(recentArticlePath);
});

test('renders the launch article with article metadata, structured copy, and accessible markup', async ({ page }) => {
  await page.goto(articlePath);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Why learning words isn’t the same as learning a language',
  );
  await expect(page.locator('.article-meta')).toContainText('Learning');
  await expect(page.locator('.article-meta')).toContainText('August 31, 2026');
  await expect(page.locator('.article-meta')).toContainText('5 min read');
  await expect(page.locator('.article-hero')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Knowing is not yet using' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'The goal is participation' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://glidelingo.com${articlePath}`,
  );
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    'https://glidelingo.com/images/blog/language-in-use-gradient.jpg',
  );

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

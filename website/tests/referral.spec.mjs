import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const token = 'R'.repeat(43);

test('captures a referral only from the fragment, scrubs it, and offers explicit destinations', async ({ page }) => {
  /** @type {string[]} */
  const consoleMessages = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  await page.goto(`/referral/#handoff=${token}`);
  await expect(page.getByRole('heading', { name: 'Your referral is ready.' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByRole('link', { name: 'Continue in browser' }))
    .toHaveAttribute('href', `https://app.glidelingo.com/referral#handoff=${token}`);
  await expect(page.getByRole('link', { name: 'Continue in GlideLingo' }))
    .toHaveAttribute('href', `glidelingo://app/referral?handoff=${token}`);
  expect(consoleMessages.join('\n')).not.toContain(token);
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(1);
});

test('recovers from malformed and expired handoffs without blocking ordinary sign in', async ({ page }) => {
  await page.goto('/referral/#handoff=not-valid');
  await expect(page.getByRole('heading', { name: 'This referral link is not valid.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue to sign in' }))
    .toHaveAttribute('href', 'https://app.glidelingo.com/sign-in');
  await page.evaluate(({ token }) => {
    sessionStorage.setItem('glidelingo.referral-handoff.v1', JSON.stringify({ capturedAt: 1, expiresAt: 900001, handoff: token }));
  }, { token });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This referral link has expired.' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test('has no automatically detectable accessibility violations', async ({ page }) => {
  await page.goto(`/referral/#handoff=${token}`);
  await expect(page.getByRole('heading', { name: 'Your referral is ready.' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('uses the in-memory fallback when the browser denies session storage access', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new DOMException('Blocked', 'SecurityError'); },
    });
  });

  await page.goto(`/referral/#handoff=${token}`);
  await expect(page.getByRole('heading', { name: 'Your referral is ready.' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByRole('link', { name: 'Continue without referral' })).toBeVisible();
});

import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, type Page } from '@playwright/test';

import type { ClerkTestAccount } from './clerk-test-account';

export async function prepareClerkPage(page: Page) {
  await setupClerkTestingToken({ page });
}

export async function registerAndReachHome(page: Page, account: ClerkTestAccount) {
  const currentUrl = page.url();
  await page.goto(currentUrl.startsWith('http') ? new URL('/', currentUrl).toString() : '/');
  await expect(page.getByText('Welcome back.', { exact: true }).filter({ visible: true })).toBeVisible();

  await page.getByRole('link', { name: 'Create an account' }).filter({ visible: true }).click();
  await page.getByLabel('Email address').filter({ visible: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).filter({ visible: true }).fill(account.password);
  await page.getByLabel('Confirm password').filter({ visible: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).filter({ visible: true }).click();

  await expect(page.getByText('Check your email.', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByLabel('Verification code').filter({ visible: true }).fill('424242');
  await page.getByRole('button', { name: 'Verify email' }).filter({ visible: true }).click();

  await expect(page.getByText('What should we call you?', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByLabel('First name').filter({ visible: true }).fill(account.firstName);
  await page.getByRole('button', { name: 'Continue', exact: true }).filter({ visible: true }).click();

  await expect(page.getByText("Learn the Greek you'll actually use.", { exact: true })).toBeVisible();
  await page.getByTestId('onboarding-start').click();
  await page.getByTestId('onboarding-goal-foundation').click();
  await page.getByTestId('onboarding-goal-continue').click();
  await page.getByTestId('onboarding-rhythm-three').click();
  await page.getByTestId('onboarding-rhythm-continue').click();
  await page.getByRole('button', { name: 'Try the first sound' }).click();
  await page.getByRole('radio', { name: 'Greek letter α' }).click();
  await page.getByTestId('onboarding-sample-check').click();
  await page.getByTestId('onboarding-sample-continue').click();
  await page.getByRole('button', { name: 'See my options' }).click();
  await page.getByTestId('onboarding-free-continue').click();

  await expect(page.getByText('Keep your course moving.', { exact: true })).toBeVisible();
}

export async function completeFirstLesson(page: Page) {
  await page.getByTestId('start-lesson').click();
  await expect(page.getByLabel('Leave sitting')).toBeVisible();

  for (let step = 0; step < 30; step += 1) {
    const done = page.getByRole('button', { name: 'Back to Home', exact: true }).filter({ visible: true });
    if (await done.isVisible()) {
      await done.click();
      await expectCompletedCourseHome(page);
      return;
    }

    const continueButton = page.getByRole('button', { name: 'Continue', exact: true }).filter({ visible: true });
    if (await continueButton.isVisible()) {
      await continueButton.click();
      continue;
    }

    const choices = page.getByRole('button', { name: /^[1-9]\. / }).filter({ visible: true });
    const choiceCount = await choices.count();
    for (let index = 0; index < choiceCount; index += 1) {
      await choices.nth(index).click();
      if (await continueButton.isVisible()) break;
    }
  }

  throw new Error('The authored first lesson did not reach its completion state.');
}

export async function signOutAndSignBackIn(page: Page, account: ClerkTestAccount) {
  await page.getByRole('button', { name: 'Profile and settings' }).filter({ visible: true }).first().click();
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
  await page.getByTestId('sign-out').click();
  await expect(page.getByText('Welcome back.', { exact: true }).filter({ visible: true })).toBeVisible();

  await page.getByLabel('Email address').filter({ visible: true }).fill(account.email);
  await page.getByLabel('Password').filter({ visible: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).click();
  await expectCompletedCourseHome(page);
}

export async function signOutForCleanup(page: Page) {
  await page.getByRole('button', { name: 'Profile and settings' }).filter({ visible: true }).first().click();
  await page.getByTestId('sign-out').click();
  await expect(page.getByText('Welcome back.', { exact: true }).filter({ visible: true })).toBeVisible();
}

export async function expectCompletedCourseHome(page: Page) {
  await expect(page.getByText('COURSE', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('100%', { exact: true }).filter({ visible: true })).toBeVisible();
}

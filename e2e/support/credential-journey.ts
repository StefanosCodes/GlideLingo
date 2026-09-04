import { expect, type Page } from '@playwright/test';

export async function exerciseCredentialRecoveryJourney(page: Page) {
  const signInHeading = page.getByText('Welcome back.', { exact: true }).filter({ visible: true });
  const emailField = page.getByLabel('Email address').filter({ visible: true });
  const passwordField = page.getByLabel('Password').filter({ visible: true });

  await expect(signInHeading).toBeVisible();
  await expect(emailField).toBeVisible();

  await emailField.fill('not-an-email');
  await passwordField.fill('valid-length-password');
  await page.getByRole('button', { name: 'Sign in' }).filter({ visible: true }).click();

  await expect(page.getByRole('alert').filter({ visible: true })).toHaveText('Enter a valid email address.');

  await page.getByRole('link', { name: 'Create an account' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(page.getByText('Create your account.', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel('Confirm password').filter({ visible: true })).toBeVisible();

  await page.getByRole('link', { name: 'Sign in' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(signInHeading).toBeVisible();
  await expect(emailField).toHaveValue('');
}

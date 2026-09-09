import { clerkSetup } from '@clerk/testing/playwright';

export default async function globalSetup() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();

  if (!publishableKey?.startsWith('pk_test_')) {
    throw new Error('Clerk authenticated E2E must use a development publishable key.');
  }
  if (!secretKey?.startsWith('sk_test_')) {
    throw new Error('Clerk authenticated E2E must use a development secret key.');
  }

  await clerkSetup({
    dotenv: false,
    publishableKey,
    secretKey,
  });
}

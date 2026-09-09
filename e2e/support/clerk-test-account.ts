import { createClerkClient } from '@clerk/backend';
import { randomUUID } from 'node:crypto';

export type ClerkTestAccount = {
  email: string;
  firstName: string;
  password: string;
};

export function createClerkTestAccount(): ClerkTestAccount {
  const unique = randomUUID().replaceAll('-', '');
  return {
    email: `glidelingo-e2e-${unique}+clerk_test@example.com`,
    firstName: 'Glide',
    password: `Glide!${unique}9a`,
  };
}

export async function deleteClerkTestAccount(email: string) {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey?.startsWith('sk_test_')) {
    throw new Error('Refusing Clerk test-user cleanup without a development secret key.');
  }

  const clerkClient = createClerkClient({ secretKey });
  const users = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
  await Promise.all(users.data.map((user) => clerkClient.users.deleteUser(user.id)));
}

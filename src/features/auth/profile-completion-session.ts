export async function signOutFromProfileCompletion(
  signOut: () => Promise<unknown>,
): Promise<string | null> {
  try {
    await signOut();
    return null;
  } catch {
    return 'We could not sign you out. Please try again.';
  }
}

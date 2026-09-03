import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootLayout = readFileSync(new URL('../../../app/_layout.tsx', import.meta.url), 'utf8');
const legacyPath = readFileSync(new URL('../../../app/(app)/path.tsx', import.meta.url), 'utf8');
const legacyReview = readFileSync(new URL('../../../app/(app)/review.tsx', import.meta.url), 'utf8');
const legacyProgress = readFileSync(new URL('../../../app/(app)/progress.tsx', import.meta.url), 'utf8');

test('signed-out direct navigation cannot enter any learning, profile, billing, or diagnostics route', () => {
  const protectedBlock = rootLayout.match(/<Stack\.Protected guard=\{signedIn\}>([\s\S]*?)<\/Stack\.Protected>/)?.[1];
  assert.ok(protectedBlock, 'signed-in protected route group is missing');

  for (const route of ['(app)', 'course/[id]', 'lesson/[id]', 'rhythm', 'kit', 'diagnostics', 'subscription']) {
    assert.match(protectedBlock, new RegExp(`name=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
  }
  assert.doesNotMatch(protectedBlock, /name=["']\(auth\)["']/);
});

test('root layout waits for Clerk before choosing signed-in or signed-out routes', () => {
  assert.match(rootLayout, /if \(!isLoaded\) \{\s*return \(/);
  assert.match(rootLayout, /<AuthLoadingScreen \/>/);
  assert.match(rootLayout, /testID="auth-session-loading"/);
  assert.doesNotMatch(rootLayout, /const signedIn = isLoaded && isSignedIn && Boolean\(userId\)/);
});

test('previously distributed learning routes remain authenticated redirects', () => {
  assert.match(legacyPath, /<Redirect href=["']\/quests["']/);
  assert.match(legacyReview, /<Redirect href=["']\/phrases["']/);
  assert.match(legacyProgress, /<Redirect href=["']\/profile["']/);
});

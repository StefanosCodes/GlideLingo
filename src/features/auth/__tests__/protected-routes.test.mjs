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

test('human tutor routes require both sign-in and the explicit client flag', () => {
  const marketplaceBlock = rootLayout.match(
    /<Stack\.Protected guard=\{signedIn && isHumanTutorMarketplaceEnabled\(\)\}>([\s\S]*?)<\/Stack\.Protected>/,
  )?.[1];
  assert.ok(marketplaceBlock, 'marketplace feature-protected route group is missing');
  for (const route of [
    'tutor/apply',
    'tutor/profile',
    'tutor/availability',
    'tutors/index',
    'tutors/[tutorId]',
    'marketplace-operations/tutor-applications',
  ]) {
    assert.match(
      marketplaceBlock,
      new RegExp(`name=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`),
    );
  }
});

test('marketplace message routes require sign-in plus both marketplace and messaging flags', () => {
  const messagingBlock = rootLayout.match(
    /<Stack\.Protected guard=\{signedIn && isHumanTutorMarketplaceEnabled\(\) && isHumanTutorMessagingEnabled\(\)\}>([\s\S]*?)<\/Stack\.Protected>/,
  )?.[1];
  assert.ok(messagingBlock, 'messaging feature-protected route group is missing');
  for (const route of ['messages/index', 'messages/[conversationId]', 'marketplace-operations/message-reports']) {
    assert.match(
      messagingBlock,
      new RegExp(`name=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`),
    );
  }
});

test('previously distributed learning routes remain authenticated redirects', () => {
  assert.match(legacyPath, /<Redirect href=["']\/quests["']/);
  assert.match(legacyReview, /<Redirect href=["']\/phrases["']/);
  assert.match(legacyProgress, /<Redirect href=["']\/profile["']/);
});

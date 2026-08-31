import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootLayout = readFileSync(new URL('../../../app/_layout.tsx', import.meta.url), 'utf8');

test('signed-out direct navigation cannot enter any learning, profile, billing, or diagnostics route', () => {
  const protectedBlock = rootLayout.match(/<Stack\.Protected guard=\{signedIn\}>([\s\S]*?)<\/Stack\.Protected>/)?.[1];
  assert.ok(protectedBlock, 'signed-in protected route group is missing');

  for (const route of ['(app)', 'course/[id]', 'lesson/[id]', 'rhythm', 'kit', 'diagnostics', 'subscription']) {
    assert.match(protectedBlock, new RegExp(`name=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
  }
  assert.doesNotMatch(protectedBlock, /name=["']\(auth\)["']/);
});

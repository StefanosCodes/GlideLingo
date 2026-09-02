import { expect, test } from '@jest/globals';

import { shouldUseCompactHeader } from '@/components/screen-header-layout';

test('uses compact controls on a 320-point viewport', () => {
  expect(shouldUseCompactHeader({ fontScale: 1, width: 320 })).toBe(true);
});

test('uses compact controls for large text on a wider viewport', () => {
  expect(shouldUseCompactHeader({ fontScale: 2, width: 600 })).toBe(true);
});

test('keeps full labels when width and text scale allow them', () => {
  expect(shouldUseCompactHeader({ fontScale: 1, width: 600 })).toBe(false);
});

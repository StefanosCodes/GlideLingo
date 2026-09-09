import { expect, test } from '@jest/globals';

import { primaryDestinations } from '@/features/product-shell/navigation';

test('defines the canonical primary destinations in product order', () => {
  expect(primaryDestinations.map(({ id, label }) => ({ id, label }))).toEqual([
    { id: 'home', label: 'Home' },
    { id: 'course', label: 'Course' },
    { id: 'speak', label: 'Speak' },
    { id: 'practice', label: 'Practice' },
    { id: 'progress', label: 'Progress' },
  ]);
  expect(primaryDestinations.map(({ href }) => href)).toEqual([
    '/',
    '/course',
    '/speak',
    '/practice',
    '/progress',
  ]);
});

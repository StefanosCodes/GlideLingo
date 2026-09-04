import { expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';

import { LegacyRedirect } from '@/features/product-shell/legacy-redirect';

let mockRedirectHref: unknown;

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: unknown }) => {
    mockRedirectHref = href;
    return null;
  },
  useLocalSearchParams: () => ({ source: 'shortcut', unit: ['one', 'two'] }),
}));

test('preserves valid deep-link parameters while assigning the canonical practice mode', async () => {
  await render(<LegacyRedirect mode="letters" pathname="/practice" />);

  expect(mockRedirectHref).toEqual({
    pathname: '/practice',
    params: { mode: 'letters', source: 'shortcut', unit: ['one', 'two'] },
  });
});

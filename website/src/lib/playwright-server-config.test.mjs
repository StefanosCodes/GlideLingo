import { describe, expect, it } from 'vitest';

import { resolvePlaywrightServerConfig } from '../../scripts/playwright-server-config.mjs';

describe('resolvePlaywrightServerConfig', () => {
  it('uses the fixed local host and default port when no override is provided', () => {
    expect(resolvePlaywrightServerConfig({})).toEqual({
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:4322',
      port: 4322,
    });
  });

  it('accepts a valid digits-only port override', () => {
    expect(resolvePlaywrightServerConfig({ PLAYWRIGHT_PORT: '4401' })).toEqual({
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:4401',
      port: 4401,
    });
  });

  it('canonicalizes the default HTTP port in the origin', () => {
    expect(resolvePlaywrightServerConfig({ PLAYWRIGHT_PORT: '80' })).toEqual({
      host: '127.0.0.1',
      origin: 'http://127.0.0.1',
      port: 80,
    });
  });

  it('rejects a numeric prefix with a malformed suffix', () => {
    expect(() => resolvePlaywrightServerConfig({ PLAYWRIGHT_PORT: '4401oops' })).toThrow(
      'expected decimal digits only',
    );
  });

  it('rejects port zero', () => {
    expect(() => resolvePlaywrightServerConfig({ PLAYWRIGHT_PORT: '0' })).toThrow(
      'expected an integer from 1 to 65535',
    );
  });

  it('rejects a port above the maximum', () => {
    expect(() => resolvePlaywrightServerConfig({ PLAYWRIGHT_PORT: '65536' })).toThrow(
      'expected an integer from 1 to 65535',
    );
  });
});

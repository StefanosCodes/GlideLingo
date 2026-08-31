import { describe, expect, it } from 'vitest';

import { resolveMacDownload } from './download-config.mjs';

const validEnvironment = {
  PUBLIC_MAC_DOWNLOAD_STATE: 'active',
  PUBLIC_MAC_DOWNLOAD_URL:
    'https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v0.1.0/GlideLingo-0.1.0-universal.dmg',
  PUBLIC_MAC_CHECKSUM_URL:
    'https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v0.1.0/SHA256SUMS.txt',
  PUBLIC_MAC_VERSION: '0.1.0',
  PUBLIC_MAC_RELEASE_DATE: '2026-08-31',
};

describe('resolveMacDownload', () => {
  it('returns a safe unavailable state for an unconfigured preview', () => {
    expect(resolveMacDownload({})).toEqual({
      available: false,
      reason: 'release-not-configured',
    });
  });

  it('rejects release metadata without an explicit state', () => {
    expect(() => resolveMacDownload({ PUBLIC_MAC_VERSION: '0.1.0' })).toThrow(
      'PUBLIC_MAC_DOWNLOAD_STATE is required whenever release metadata is configured.',
    );
  });

  it('requires an explicit state on the production branch', () => {
    expect(() => resolveMacDownload({ CF_PAGES_BRANCH: 'main' })).toThrow(
      'Production must explicitly set PUBLIC_MAC_DOWNLOAD_STATE to active or disabled.',
    );
  });

  it('supports an explicit production coming-soon state', () => {
    expect(resolveMacDownload({ CF_PAGES_BRANCH: 'main', PUBLIC_MAC_DOWNLOAD_STATE: 'disabled' })).toEqual({
      available: false,
      reason: 'release-disabled',
    });
  });

  it('rejects an incomplete configuration even when downloads are disabled', () => {
    expect(() =>
      resolveMacDownload({ PUBLIC_MAC_DOWNLOAD_STATE: 'disabled', PUBLIC_MAC_VERSION: '0.1.0' }),
    ).toThrow(
      'Download configuration is incomplete; missing: PUBLIC_MAC_DOWNLOAD_URL, PUBLIC_MAC_CHECKSUM_URL, PUBLIC_MAC_RELEASE_DATE.',
    );
  });

  it('supports rollback by disabling a complete, valid active configuration', () => {
    expect(resolveMacDownload({ ...validEnvironment, PUBLIC_MAC_DOWNLOAD_STATE: 'disabled' })).toEqual({
      available: false,
      reason: 'release-disabled',
    });
  });

  it('rejects invalid release metadata while downloads are disabled', () => {
    expect(() =>
      resolveMacDownload({
        ...validEnvironment,
        PUBLIC_MAC_DOWNLOAD_STATE: 'disabled',
        PUBLIC_MAC_DOWNLOAD_URL: validEnvironment.PUBLIC_MAC_DOWNLOAD_URL.replace(
          'StefanosCodes/GlideLingo',
          'someone/another-repo',
        ),
      }),
    ).toThrow('download URL must be an HTTPS asset URL for the GlideLingo GitHub Releases repository.');
  });

  it('requires all release metadata when downloads are active', () => {
    expect(() => resolveMacDownload({ PUBLIC_MAC_DOWNLOAD_STATE: 'active' })).toThrow(
      'Active download configuration is missing: PUBLIC_MAC_DOWNLOAD_URL, PUBLIC_MAC_CHECKSUM_URL, PUBLIC_MAC_VERSION, PUBLIC_MAC_RELEASE_DATE.',
    );
  });

  it('accepts an exact versioned GitHub release and formats its metadata', () => {
    expect(resolveMacDownload(validEnvironment)).toEqual({
      available: true,
      downloadUrl: validEnvironment.PUBLIC_MAC_DOWNLOAD_URL,
      checksumUrl: validEnvironment.PUBLIC_MAC_CHECKSUM_URL,
      version: '0.1.0',
      releaseDate: '2026-08-31',
      formattedReleaseDate: 'Aug 31, 2026',
    });
  });

  it.each([
    ['non-HTTPS URL', { PUBLIC_MAC_DOWNLOAD_URL: validEnvironment.PUBLIC_MAC_DOWNLOAD_URL.replace('https:', 'http:') }],
    [
      'wrong repository',
      {
        PUBLIC_MAC_DOWNLOAD_URL: validEnvironment.PUBLIC_MAC_DOWNLOAD_URL.replace(
          'StefanosCodes/GlideLingo',
          'someone/another-repo',
        ),
      },
    ],
    ['non-DMG asset', { PUBLIC_MAC_DOWNLOAD_URL: validEnvironment.PUBLIC_MAC_DOWNLOAD_URL.replace('.dmg', '.zip') }],
    ['invalid version', { PUBLIC_MAC_VERSION: 'version-one' }],
    ['invalid calendar date', { PUBLIC_MAC_RELEASE_DATE: '2026-02-30' }],
    ['invalid state', { PUBLIC_MAC_DOWNLOAD_STATE: 'enabled' }],
  ])('rejects %s', (_label, override) => {
    expect(() => resolveMacDownload({ ...validEnvironment, ...override })).toThrow();
  });

  it('binds both release URLs to the version-derived desktop tag', () => {
    expect(() =>
      resolveMacDownload({
        ...validEnvironment,
        PUBLIC_MAC_CHECKSUM_URL: validEnvironment.PUBLIC_MAC_CHECKSUM_URL.replace('desktop-v0.1.0', 'desktop-v0.2.0'),
      }),
    ).toThrow('release URLs must use the tag desktop-v0.1.0.');
  });

  it('binds the DMG filename to the configured version', () => {
    expect(() =>
      resolveMacDownload({
        ...validEnvironment,
        PUBLIC_MAC_DOWNLOAD_URL: validEnvironment.PUBLIC_MAC_DOWNLOAD_URL.replace('0.1.0-universal', '0.2.0-universal'),
      }),
    ).toThrow('download URL must reference GlideLingo-0.1.0-universal.dmg.');
  });

  it('requires the checksum manifest published by the desktop release workflow', () => {
    expect(() =>
      resolveMacDownload({
        ...validEnvironment,
        PUBLIC_MAC_CHECKSUM_URL: validEnvironment.PUBLIC_MAC_CHECKSUM_URL.replace(
          'SHA256SUMS.txt',
          'GlideLingo-0.1.0-universal.dmg.sha256',
        ),
      }),
    ).toThrow('checksum URL must reference SHA256SUMS.txt.');
  });
});

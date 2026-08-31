import { describe, expect, it } from 'vitest';

import { resolveMacDownload } from './download-config.mjs';

const validEnvironment = {
  PUBLIC_MAC_DOWNLOAD_URL:
    'https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v0.1.0/GlideLingo-0.1.0-universal.dmg',
  PUBLIC_MAC_CHECKSUM_URL:
    'https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v0.1.0/GlideLingo-0.1.0-universal.dmg.sha256',
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

  it('returns a safe unavailable state for a partially configured preview', () => {
    expect(resolveMacDownload({ PUBLIC_MAC_VERSION: '0.1.0' })).toEqual({
      available: false,
      reason: 'release-not-configured',
    });
  });

  it('rejects a missing production value and names the missing keys', () => {
    expect(() => resolveMacDownload({ CF_PAGES_BRANCH: 'main' })).toThrow(
      'Production download configuration is missing: PUBLIC_MAC_DOWNLOAD_URL, PUBLIC_MAC_CHECKSUM_URL, PUBLIC_MAC_VERSION, PUBLIC_MAC_RELEASE_DATE.',
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
  ])('rejects %s', (_label, override) => {
    expect(() => resolveMacDownload({ ...validEnvironment, ...override })).toThrow();
  });

  it('rejects download and checksum assets from different release tags', () => {
    expect(() =>
      resolveMacDownload({
        ...validEnvironment,
        PUBLIC_MAC_CHECKSUM_URL: validEnvironment.PUBLIC_MAC_CHECKSUM_URL.replace('desktop-v0.1.0', 'desktop-v0.2.0'),
      }),
    ).toThrow('download and checksum URLs must reference the same GitHub release tag.');
  });
});

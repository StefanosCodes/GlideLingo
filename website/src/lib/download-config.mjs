const REQUIRED_KEYS = [
  'PUBLIC_MAC_DOWNLOAD_URL',
  'PUBLIC_MAC_CHECKSUM_URL',
  'PUBLIC_MAC_VERSION',
  'PUBLIC_MAC_RELEASE_DATE',
];

const RELEASE_PREFIX = '/StefanosCodes/GlideLingo/releases/download/';
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {Object} DownloadEnvironment
 * @property {string | undefined} [PUBLIC_MAC_DOWNLOAD_URL]
 * @property {string | undefined} [PUBLIC_MAC_CHECKSUM_URL]
 * @property {string | undefined} [PUBLIC_MAC_VERSION]
 * @property {string | undefined} [PUBLIC_MAC_RELEASE_DATE]
 * @property {string | undefined} [CF_PAGES_BRANCH]
 */

/** @param {string} rawValue @param {'download' | 'checksum'} kind */
function validateReleaseUrl(rawValue, kind) {
  /** @type {URL} */
  let url;

  try {
    url = new URL(rawValue);
  } catch {
    throw new Error(`${kind} URL must be a valid absolute URL.`);
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(RELEASE_PREFIX)
  ) {
    throw new Error(`${kind} URL must be an HTTPS asset URL for the GlideLingo GitHub Releases repository.`);
  }

  const assetPath = url.pathname.slice(RELEASE_PREFIX.length);
  const segments = assetPath.split('/');
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new Error(`${kind} URL must include one release tag and one asset filename.`);
  }

  if (kind === 'download' && !segments[1].toLowerCase().endsWith('.dmg')) {
    throw new Error('download URL must point to a DMG asset.');
  }

  if (kind === 'checksum' && !/\.(?:sha256|txt)$/i.test(segments[1])) {
    throw new Error('checksum URL must point to a .sha256 or .txt asset.');
  }

  return url;
}

/** @param {URL} url */
function releaseTag(url) {
  return url.pathname.slice(RELEASE_PREFIX.length).split('/')[0];
}

/** @param {string} value */
function validateDate(value) {
  if (!DATE_PATTERN.test(value)) {
    throw new Error('release date must use YYYY-MM-DD.');
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('release date must be a real calendar date.');
  }
}

/** @param {DownloadEnvironment | NodeJS.ProcessEnv} env */
export function resolveMacDownload(env) {
  const configuredValues = [
    env.PUBLIC_MAC_DOWNLOAD_URL,
    env.PUBLIC_MAC_CHECKSUM_URL,
    env.PUBLIC_MAC_VERSION,
    env.PUBLIC_MAC_RELEASE_DATE,
  ];
  const missingKeys = REQUIRED_KEYS.filter((_key, index) => !configuredValues[index]?.trim());
  const isProductionBranch = env.CF_PAGES_BRANCH === 'main';

  if (missingKeys.length > 0) {
    if (isProductionBranch) {
      throw new Error(`Production download configuration is missing: ${missingKeys.join(', ')}.`);
    }

    return { available: false, reason: 'release-not-configured' };
  }

  const downloadUrl = validateReleaseUrl(String(env.PUBLIC_MAC_DOWNLOAD_URL).trim(), 'download');
  const checksumUrl = validateReleaseUrl(String(env.PUBLIC_MAC_CHECKSUM_URL).trim(), 'checksum');
  const version = String(env.PUBLIC_MAC_VERSION).trim();
  const releaseDate = String(env.PUBLIC_MAC_RELEASE_DATE).trim();

  if (!SEMVER_PATTERN.test(version)) {
    throw new Error('version must use semantic versioning.');
  }

  validateDate(releaseDate);

  if (releaseTag(downloadUrl) !== releaseTag(checksumUrl)) {
    throw new Error('download and checksum URLs must reference the same GitHub release tag.');
  }

  return {
    available: true,
    downloadUrl: downloadUrl.toString(),
    checksumUrl: checksumUrl.toString(),
    version,
    releaseDate,
    formattedReleaseDate: new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${releaseDate}T00:00:00.000Z`)),
  };
}

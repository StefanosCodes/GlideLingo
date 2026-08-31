const REQUIRED_KEYS = [
  'PUBLIC_MAC_DOWNLOAD_URL',
  'PUBLIC_MAC_CHECKSUM_URL',
  'PUBLIC_MAC_VERSION',
  'PUBLIC_MAC_RELEASE_DATE',
];

const DOWNLOAD_STATE_KEY = 'PUBLIC_MAC_DOWNLOAD_STATE';
const DOWNLOAD_STATES = new Set(['active', 'disabled']);
const RELEASE_PREFIX = '/StefanosCodes/GlideLingo/releases/download/';
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {Object} DownloadEnvironment
 * @property {string | undefined} [PUBLIC_MAC_DOWNLOAD_URL]
 * @property {string | undefined} [PUBLIC_MAC_CHECKSUM_URL]
 * @property {string | undefined} [PUBLIC_MAC_VERSION]
 * @property {string | undefined} [PUBLIC_MAC_RELEASE_DATE]
 * @property {string | undefined} [PUBLIC_MAC_DOWNLOAD_STATE]
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
function releaseIdentity(url) {
  const [tag, asset] = url.pathname.slice(RELEASE_PREFIX.length).split('/');
  return { tag, asset };
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
    env.PUBLIC_MAC_DOWNLOAD_URL?.trim(),
    env.PUBLIC_MAC_CHECKSUM_URL?.trim(),
    env.PUBLIC_MAC_VERSION?.trim(),
    env.PUBLIC_MAC_RELEASE_DATE?.trim(),
  ];
  const configuredKeys = REQUIRED_KEYS.filter((_key, index) => Boolean(configuredValues[index]));
  const missingKeys = REQUIRED_KEYS.filter((_key, index) => !configuredValues[index]);
  const rawState = env[DOWNLOAD_STATE_KEY]?.trim();
  const isProductionBranch = env.CF_PAGES_BRANCH === 'main';

  if (rawState && !DOWNLOAD_STATES.has(rawState)) {
    throw new Error(`${DOWNLOAD_STATE_KEY} must be either active or disabled.`);
  }

  if (!rawState && configuredKeys.length > 0) {
    throw new Error(`${DOWNLOAD_STATE_KEY} is required whenever release metadata is configured.`);
  }

  if (!rawState && isProductionBranch) {
    throw new Error(`Production must explicitly set ${DOWNLOAD_STATE_KEY} to active or disabled.`);
  }

  if (!rawState) {
    return { available: false, reason: 'release-not-configured' };
  }

  if (configuredKeys.length > 0 && missingKeys.length > 0) {
    throw new Error(`Download configuration is incomplete; missing: ${missingKeys.join(', ')}.`);
  }

  if (rawState === 'active' && missingKeys.length > 0) {
    throw new Error(`Active download configuration is missing: ${missingKeys.join(', ')}.`);
  }

  if (rawState === 'disabled' && configuredKeys.length === 0) {
    return { available: false, reason: 'release-disabled' };
  }

  const downloadUrl = validateReleaseUrl(String(env.PUBLIC_MAC_DOWNLOAD_URL).trim(), 'download');
  const checksumUrl = validateReleaseUrl(String(env.PUBLIC_MAC_CHECKSUM_URL).trim(), 'checksum');
  const version = String(env.PUBLIC_MAC_VERSION).trim();
  const releaseDate = String(env.PUBLIC_MAC_RELEASE_DATE).trim();

  if (!SEMVER_PATTERN.test(version)) {
    throw new Error('version must use semantic versioning.');
  }

  validateDate(releaseDate);

  const expectedTag = `desktop-v${version}`;
  const expectedDmg = `GlideLingo-${version}-universal.dmg`;
  const downloadIdentity = releaseIdentity(downloadUrl);
  const checksumIdentity = releaseIdentity(checksumUrl);

  if (downloadIdentity.tag !== expectedTag || checksumIdentity.tag !== expectedTag) {
    throw new Error(`release URLs must use the tag ${expectedTag}.`);
  }

  if (downloadIdentity.asset !== expectedDmg) {
    throw new Error(`download URL must reference ${expectedDmg}.`);
  }

  if (checksumIdentity.asset !== 'SHA256SUMS.txt') {
    throw new Error('checksum URL must reference SHA256SUMS.txt.');
  }

  if (rawState === 'disabled') {
    return { available: false, reason: 'release-disabled' };
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

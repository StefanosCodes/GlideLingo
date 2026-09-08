import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTION_SITE_URL = "https://glidelingo.com/";

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "GlideLingo production desktop E2E verifier" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.text();
}

export function parsePublicDesktopRelease(html) {
  const pattern = /https:\/\/github\.com\/StefanosCodes\/GlideLingo\/releases\/download\/desktop-v(\d+\.\d+\.\d+)\/GlideLingo-(\d+\.\d+\.\d+)-universal\.dmg/g;
  const matches = [...html.matchAll(pattern)];
  const urls = [...new Set(matches.map((match) => match[0]))];
  if (urls.length !== 1) {
    throw new Error(`Expected one unique public macOS DMG URL, found ${urls.length}`);
  }
  const selected = matches.find((match) => match[0] === urls[0]);
  if (!selected || selected[1] !== selected[2]) {
    throw new Error("The public release tag and DMG filename versions do not match");
  }
  const version = selected[1];
  const tag = `desktop-v${version}`;
  const filename = `GlideLingo-${version}-universal.dmg`;
  return {
    site_url: PRODUCTION_SITE_URL,
    version,
    tag,
    filename,
    dmg_url: urls[0],
    checksums_url: `https://github.com/StefanosCodes/GlideLingo/releases/download/${tag}/SHA256SUMS.txt`,
  };
}

export function parseDmgChecksum(checksums, filename) {
  const candidates = checksums
    .split(/\r?\n/)
    .map((line) => line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i))
    .filter(Boolean)
    .filter((match) => match[2] === filename);
  if (candidates.length !== 1) {
    throw new Error(`Expected one checksum for ${filename}, found ${candidates.length}`);
  }
  return candidates[0][1].toLowerCase();
}

export async function resolvePublicDesktopRelease() {
  const release = parsePublicDesktopRelease(await fetchText(PRODUCTION_SITE_URL));
  const sha256 = parseDmgChecksum(await fetchText(release.checksums_url), release.filename);
  return { ...release, sha256 };
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function verifyPublicDesktopDownload(filePath) {
  const absolutePath = path.resolve(filePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`${absolutePath} is not a regular file`);
  }
  const release = await resolvePublicDesktopRelease();
  if (path.basename(absolutePath) !== release.filename) {
    throw new Error(`Expected ${release.filename}, received ${path.basename(absolutePath)}`);
  }
  const actualSha256 = await sha256File(absolutePath);
  if (actualSha256 !== release.sha256) {
    throw new Error(`Checksum mismatch for ${absolutePath}`);
  }
  return { ...release, file_path: absolutePath, size_bytes: fileStat.size, checksum_verified: true };
}

async function main() {
  const command = process.argv[2] ?? "resolve";
  if (command === "resolve" && process.argv.length === 3) {
    console.log(JSON.stringify(await resolvePublicDesktopRelease(), null, 2));
    return;
  }
  if (command === "verify-download" && process.argv.length === 4) {
    console.log(JSON.stringify(await verifyPublicDesktopDownload(process.argv[3]), null, 2));
    return;
  }
  throw new Error("Usage: public-desktop-release.mjs resolve | verify-download /absolute/path/to/GlideLingo.dmg");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

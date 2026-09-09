import assert from "node:assert/strict";
import test from "node:test";

import { parseDmgChecksum, parsePublicDesktopRelease } from "./public-desktop-release.mjs";

const url =
  "https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v1.2.3/GlideLingo-1.2.3-universal.dmg";

test("resolves one repeated public DMG URL into a release contract", () => {
  const release = parsePublicDesktopRelease(`<a href="${url}">Download</a><a href="${url}">Again</a>`);
  assert.deepEqual(release, {
    site_url: "https://glidelingo.com/",
    version: "1.2.3",
    tag: "desktop-v1.2.3",
    filename: "GlideLingo-1.2.3-universal.dmg",
    dmg_url: url,
    checksums_url:
      "https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v1.2.3/SHA256SUMS.txt",
  });
});

test("rejects ambiguous public DMG releases", () => {
  const second =
    "https://github.com/StefanosCodes/GlideLingo/releases/download/desktop-v1.2.4/GlideLingo-1.2.4-universal.dmg";
  assert.throws(() => parsePublicDesktopRelease(`${url} ${second}`), /one unique/);
});

test("selects the exact DMG checksum", () => {
  const digest = "a".repeat(64);
  assert.equal(
    parseDmgChecksum(
      `${"b".repeat(64)}  GlideLingo-1.2.3-universal.zip\n${digest}  GlideLingo-1.2.3-universal.dmg\n`,
      "GlideLingo-1.2.3-universal.dmg",
    ),
    digest,
  );
});

test("rejects a missing DMG checksum", () => {
  assert.throws(() => parseDmgChecksum("", "GlideLingo-1.2.3-universal.dmg"), /found 0/);
});

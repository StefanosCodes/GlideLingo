import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const active = process.env.PUBLIC_MAC_DOWNLOAD_STATE === 'active';
/** @param {string} path */
const read = (path) => readFile(new URL(path, root), 'utf8');

await Promise.all([
  access(new URL('index.html', root)),
  access(new URL('404.html', root)),
  access(new URL('_headers', root)),
  access(new URL('robots.txt', root)),
  access(new URL('sitemap-index.xml', root)),
]);

const [home, notFound, headers, robots] = await Promise.all([
  read('index.html'),
  read('404.html'),
  read('_headers'),
  read('robots.txt'),
]);

assert.match(home, /<title>GlideLingo — Language learning, redesigned<\/title>/);
assert.match(home, /rel="canonical" href="https:\/\/glidelingo\.com\/"/);
assert.match(home, /id="main-content"/);
assert.match(home, /Language learning,/);
assert.match(home, /glidelingo-bird-black\.svg/);
assert.match(home, /brand-name/);
assert.match(home, /data-video-state="ready"/);
assert.doesNotMatch(home, /Video coming soon/);
assert.match(home, /<video[^>]+poster="\/images\/product-home\.png"/);
assert.match(home, /<video[^>]+controls[^>]+data-autoplay-when-visible="true"[^>]+loop[^>]+muted/);
assert.match(home, /<source[^>]+glidelingo-product-walkthrough\.webm[^>]+video\/webm/);
assert.match(home, /<source[^>]+glidelingo-product-walkthrough\.mp4/);
assert.match(home, /<track[^>]+kind="captions"[^>]+glidelingo-product-walkthrough\.vtt/);
assert.match(home, /Download for Mac/);
assert.match(home, /button-platform-icon/);
assert.doesNotMatch(home, /Desktop apps|Choose your desktop|Download for Windows/);
assert.match(home, /<script[^>]+src="\/scripts\/video-player\.js"[^>]*><\/script>/i);
assert.doesNotMatch(home, /<script(?![^>]+src=)(?:\s|>)/i);
assert.doesNotMatch(home, /<form(?:\s|>)/i);
assert.doesNotMatch(home, /document\.cookie|localStorage|sessionStorage/i);
assert.match(notFound, /This page flew off course/);
assert.match(headers, /Content-Security-Policy:/);
assert.match(headers, /script-src 'self'/);
assert.match(headers, /Permissions-Policy:/);
assert.match(robots, /Sitemap: https:\/\/glidelingo\.com\/sitemap-index\.xml/);

if (active) {
  const downloadUrl = process.env.PUBLIC_MAC_DOWNLOAD_URL?.trim();

  assert.ok(downloadUrl, 'Active output verification requires PUBLIC_MAC_DOWNLOAD_URL.');
  assert.match(home, /data-download-state="available"/);
  assert.ok(home.includes(downloadUrl), 'Active output must contain the configured DMG URL.');
} else {
  assert.match(home, /data-download-state="unavailable"/);
  assert.doesNotMatch(home, /releases\/download/);
}

console.log(`Verified ${active ? 'active' : 'disabled'} hero CTA output in ${join(root.pathname)}.`);

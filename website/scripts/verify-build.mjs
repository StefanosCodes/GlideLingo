import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const active = process.argv.includes('--active');
/** @param {string} path */
const read = (path) => readFile(new URL(path, root), 'utf8');

await Promise.all([
  access(new URL('index.html', root)),
  access(new URL('404.html', root)),
  access(new URL('_headers', root)),
  access(new URL('_redirects', root)),
  access(new URL('robots.txt', root)),
  access(new URL('sitemap-index.xml', root)),
]);

const [home, notFound, headers, redirects, robots] = await Promise.all([
  read('index.html'),
  read('404.html'),
  read('_headers'),
  read('_redirects'),
  read('robots.txt'),
]);

assert.match(home, /<title>GlideLingo — Language practice that keeps moving<\/title>/);
assert.match(home, /rel="canonical" href="https:\/\/glidelingo\.com\/"/);
assert.match(home, /id="main-content"/);
assert.match(home, /How it works/);
assert.match(home, /Platform availability/);
assert.doesNotMatch(home, /<script(?:\s|>)/i);
assert.doesNotMatch(home, /<form(?:\s|>)/i);
assert.doesNotMatch(home, /document\.cookie|localStorage|sessionStorage/i);
assert.match(notFound, /This page flew off course/);
assert.match(headers, /Content-Security-Policy:/);
assert.match(headers, /script-src 'none'/);
assert.match(headers, /Permissions-Policy:/);
assert.match(redirects, /^https:\/\/www\.glidelingo\.com\/\* https:\/\/glidelingo\.com\/:splat 301/m);
assert.match(robots, /Sitemap: https:\/\/glidelingo\.com\/sitemap-index\.xml/);

if (active) {
  assert.match(home, /data-download-state="available"/);
  assert.match(home, /GlideLingo-0\.1\.0-universal\.dmg/);
  assert.match(home, /GlideLingo-0\.1\.0-universal\.dmg\.sha256/);
} else {
  assert.match(home, /data-download-state="unavailable"/);
  assert.match(home, /Mac release coming soon/);
  assert.doesNotMatch(home, /releases\/download/);
}

console.log(`Verified ${active ? 'active-download' : 'coming-soon'} static output in ${join(root.pathname)}.`);

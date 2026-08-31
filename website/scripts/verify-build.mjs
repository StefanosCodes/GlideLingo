import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url);
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
assert.match(home, /data-video-state="awaiting-source"/);
assert.match(home, /Video coming soon/);
assert.doesNotMatch(home, /Desktop apps|Choose your desktop|Download for Mac|Download for Windows/);
assert.doesNotMatch(home, /releases\/download/);
assert.doesNotMatch(home, /<script(?:\s|>)/i);
assert.doesNotMatch(home, /<form(?:\s|>)/i);
assert.doesNotMatch(home, /document\.cookie|localStorage|sessionStorage/i);
assert.match(notFound, /This page flew off course/);
assert.match(headers, /Content-Security-Policy:/);
assert.match(headers, /script-src 'none'/);
assert.match(headers, /Permissions-Policy:/);
assert.match(robots, /Sitemap: https:\/\/glidelingo\.com\/sitemap-index\.xml/);

console.log(`Verified static landing page output in ${join(root.pathname)}.`);

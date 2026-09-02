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
  access(new URL('blog/index.html', root)),
  access(new URL('blog/why-learning-words-isnt-enough/index.html', root)),
  access(new URL('privacy/index.html', root)),
  access(new URL('terms/index.html', root)),
  access(new URL('images/blog/from-words-to-conversation.webp', root)),
  access(new URL('_headers', root)),
  access(new URL('robots.txt', root)),
  access(new URL('sitemap-index.xml', root)),
]);

const [home, notFound, blog, article, privacy, terms, headers, robots] = await Promise.all([
  read('index.html'),
  read('404.html'),
  read('blog/index.html'),
  read('blog/why-learning-words-isnt-enough/index.html'),
  read('privacy/index.html'),
  read('terms/index.html'),
  read('_headers'),
  read('robots.txt'),
]);

assert.match(home, /<title>GlideLingo — Language learning, redesigned<\/title>/);
assert.match(home, /rel="canonical" href="https:\/\/glidelingo\.com\/"/);
assert.match(home, /id="main-content"/);
assert.match(home, /Learn the language\./);
assert.match(home, /Enter the world\./);
assert.match(home, /glidelingo-bird-black\.svg/);
assert.match(home, /brand-name/);
assert.match(home, /data-video-state="ready"/);
assert.doesNotMatch(home, /Video coming soon/);
assert.match(home, /<video[^>]+poster="\/images\/product-home\.png"/);
assert.match(home, /<video[^>]+controls[^>]+data-autoplay-when-visible="true"[^>]+loop[^>]+muted/);
assert.match(home, /<source[^>]+glidelingo-product-walkthrough\.webm[^>]+video\/webm/);
assert.match(home, /<source[^>]+glidelingo-product-walkthrough\.mp4/);
assert.match(home, /<track[^>]+kind="captions"[^>]+glidelingo-product-walkthrough\.vtt/);
assert.match(home, />Download<svg[^>]+button-apple-icon/);
assert.doesNotMatch(home, /Download for Mac/);
assert.match(home, /button-platform-icon/);
assert.match(home, /button-apple-icon/);
assert.match(home, /id="pricing"/);
assert.match(home, /href="\/blog\/"/);
assert.match(home, /href="\/privacy\/"/);
assert.match(home, /href="\/terms\/"/);
assert.match(home, /\$19\.99/);
assert.match(home, /Billed monthly\. Cancel anytime\./);
assert.doesNotMatch(home, /Desktop apps|Choose your desktop|Download for Windows/);
assert.match(home, /<script[^>]+src="\/scripts\/video-player\.js"[^>]*><\/script>/i);
assert.doesNotMatch(home, /<script(?![^>]+src=)(?:\s|>)/i);
assert.doesNotMatch(home, /<form(?:\s|>)/i);
assert.doesNotMatch(home, /document\.cookie|localStorage|sessionStorage/i);
assert.match(notFound, /This page flew off course/);
assert.match(blog, /<title>Blog — GlideLingo<\/title>/);
assert.match(blog, /rel="canonical" href="https:\/\/glidelingo\.com\/blog\/"/);
assert.match(blog, /Why learning words isn’t the same as learning a language/);
assert.match(blog, /images\/blog\/from-words-to-conversation\.webp/);
assert.match(article, /property="og:type" content="article"/);
assert.match(article, /rel="canonical" href="https:\/\/glidelingo\.com\/blog\/why-learning-words-isnt-enough\/"/);
assert.match(article, /Knowing is not yet using/);
assert.match(article, /The goal is participation/);
assert.match(privacy, /<title>Privacy Policy — GlideLingo<\/title>/);
assert.match(privacy, /rel="canonical" href="https:\/\/glidelingo\.com\/privacy\/"/);
assert.match(privacy, /Google sign-in data/);
assert.match(privacy, /does not sell personal information/i);
assert.match(terms, /<title>Terms of Service — GlideLingo<\/title>/);
assert.match(terms, /rel="canonical" href="https:\/\/glidelingo\.com\/terms\/"/);
assert.match(terms, /Subscriptions and billing/);
assert.doesNotMatch(blog + article, /https?:\/\/(?!glidelingo\.com|github\.com)/);
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

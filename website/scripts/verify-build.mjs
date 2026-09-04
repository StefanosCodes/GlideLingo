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
  access(new URL('blog/from-first-phrase-to-real-conversation/index.html', root)),
  access(new URL('blog/how-to-practice-speaking-alone/index.html', root)),
  access(new URL('blog/review-that-makes-language-available/index.html', root)),
  access(new URL('blog/build-a-language-week-you-can-repeat/index.html', root)),
  access(new URL('blog/designing-for-calm-momentum/index.html', root)),
  access(new URL('blog/what-speaking-with-confidence-means/index.html', root)),
  access(new URL('blog/why-learning-words-isnt-enough/index.html', root)),
  access(new URL('images/blog/conversation-gradient.jpg', root)),
  access(new URL('images/blog/language-in-use-gradient.jpg', root)),
  access(new URL('images/blog/speaking-alone-gradient.jpg', root)),
  access(new URL('images/blog/useful-review-gradient.jpg', root)),
  access(new URL('images/blog/weekly-rhythm-gradient.jpg', root)),
  access(new URL('images/blog/calm-momentum-gradient.jpg', root)),
  access(new URL('images/blog/speaking-confidence-gradient.jpg', root)),
  access(new URL('_headers', root)),
  access(new URL('robots.txt', root)),
  access(new URL('sitemap-index.xml', root)),
]);

const [home, notFound, blog, article, headers, robots] = await Promise.all([
  read('index.html'),
  read('404.html'),
  read('blog/index.html'),
  read('blog/why-learning-words-isnt-enough/index.html'),
  read('_headers'),
  read('robots.txt'),
]);

assert.match(home, /<title>GlideLingo \| Learn a language\. Speak with confidence\.<\/title>/);
assert.match(home, /rel="canonical" href="https:\/\/glidelingo\.com\/"/);
assert.match(home, /id="main-content"/);
assert.match(home, /Learn a language\./);
assert.match(home, /Speak with confidence\./);
assert.match(home, /See how speaking starts\./);
assert.match(home, /Start with Starter\. Keep speaking with Professional\./);
assert.match(home, /Ready to speak a new language\?/);
assert.match(home, /glidelingo-bird-black\.svg/);
assert.match(home, /brand-name/);
assert.match(home, /data-video-state="ready"/);
assert.doesNotMatch(home, /Video coming soon/);
assert.match(home, /<video[^>]+poster="\/images\/product-home\.png"/);
assert.match(home, /<video[^>]+controls[^>]+data-autoplay-when-visible="true"[^>]+loop[^>]+muted/);
assert.match(home, /<source[^>]+glidelingo-product-walkthrough\.webm[^>]+video\/webm/);
assert.match(home, /<source[^>]+glidelingo-product-walkthrough\.mp4/);
assert.match(home, /<track[^>]+kind="captions"[^>]+glidelingo-product-walkthrough\.vtt/);
assert.match(home, />See how it works<\/a>/);
assert.match(home, /Free to start/);
assert.match(home, /button-platform-icon/);
assert.match(home, /button-apple-icon/);
assert.match(home, /id="pricing"/);
assert.match(home, /href="\/blog\/"/);
assert.match(home, /\$19\.99/);
assert.match(home, /Billed monthly\. Cancel anytime\./);
assert.match(home, />Start free<\/a>/);
assert.match(home, />Go Professional<\/a>/);
assert.match(home, /For new learners/);
assert.match(home, /Weekly learning rhythm/);
assert.match(home, /For committed learners/);
assert.match(home, /Everything in Starter/);
assert.doesNotMatch(home, /Greek/);
assert.doesNotMatch(home, /Desktop apps|Choose your desktop|Download for Windows/);
assert.match(home, /<script[^>]+src="\/scripts\/video-player\.js"[^>]*><\/script>/i);
assert.doesNotMatch(home, /<script(?![^>]+src=)(?:\s|>)/i);
assert.doesNotMatch(home, /<form(?:\s|>)/i);
assert.doesNotMatch(home, /document\.cookie|localStorage|sessionStorage/i);
assert.match(notFound, /This page flew off course/);
assert.match(blog, /<title>Blog \| GlideLingo<\/title>/);
assert.match(blog, /rel="canonical" href="https:\/\/glidelingo\.com\/blog\/"/);
assert.match(blog, /<h1 id="recent-heading">Recent<\/h1>/);
assert.match(blog, /<h2 id="more-stories-heading">All stories<\/h2>/);
assert.match(blog, /Why learning words isn’t the same as learning a language/);
assert.match(blog, /From first phrase to real conversation/);
assert.match(blog, /How to practice speaking when no one else is around/);
assert.match(blog, /Review should make language available/);
assert.match(blog, /Build a language-learning week you can repeat/);
assert.match(blog, /Designing GlideLingo for calm momentum/);
assert.match(blog, /What speaking with confidence actually means/);
assert.match(blog, /data-blog-filter="speaking"/);
assert.match(blog, /src="\/scripts\/blog-filter\.js"/);
assert.match(blog, /images\/blog\/language-in-use-gradient\.jpg/);
assert.match(article, /property="og:type" content="article"/);
assert.match(article, /rel="canonical" href="https:\/\/glidelingo\.com\/blog\/why-learning-words-isnt-enough\/"/);
assert.match(article, /Knowing is not yet using/);
assert.match(article, /The goal is participation/);
assert.doesNotMatch(blog + article, /https?:\/\/(?!glidelingo\.com|github\.com)/);
assert.match(headers, /Content-Security-Policy:/);
assert.match(headers, /script-src 'self'/);
assert.match(headers, /Permissions-Policy:/);
assert.match(robots, /Sitemap: https:\/\/glidelingo\.com\/sitemap-index\.xml/);

if (active) {
  const downloadUrl = process.env.PUBLIC_MAC_DOWNLOAD_URL?.trim();

  assert.ok(downloadUrl, 'Active output verification requires PUBLIC_MAC_DOWNLOAD_URL.');
  assert.match(home, /data-download-state="available"/);
  assert.match(home, />\s*Download for macOS\s*<svg[^>]+button-apple-icon/);
  assert.match(home, /Universal for Apple silicon and Intel Macs/);
  assert.match(home, /GlideLingo for macOS is now available\. <span aria-hidden="true">🎉<\/span>/);
  assert.match(home, /aria-label="Product announcement"/);
  assert.ok(home.includes(downloadUrl), 'Active output must contain the configured DMG URL.');
} else {
  assert.match(home, /data-download-state="unavailable"/);
  assert.match(home, />\s*Get started on macOS\s*<svg[^>]+button-apple-icon/);
  assert.match(home, /Available for macOS/);
  assert.doesNotMatch(home, /aria-label="Product announcement"/);
  assert.doesNotMatch(home, /releases\/download/);
  assert.match(home, /href="https:\/\/github\.com\/StefanosCodes\/GlideLingo\/releases"/);
}

console.log(`Verified ${active ? 'active' : 'fallback'} homepage CTA output in ${join(root.pathname)}.`);

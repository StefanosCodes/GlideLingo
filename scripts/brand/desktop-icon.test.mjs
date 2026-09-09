import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath));
}

function birdPath(svg) {
  const match = svg.match(/<path d="([^"]+)"/);
  assert.ok(match, 'brand SVG must contain one bird path');
  return match[1];
}

test('desktop icon uses the exact approved website bird', () => {
  const website = read('website/public/brand/glidelingo-bird-black.svg').toString('utf8');
  const desktop = read('assets/brand/glidelingo-desktop-icon.svg').toString('utf8');

  assert.equal(birdPath(desktop), birdPath(website));
  assert.match(desktop, /fill="#0A0A0A"/);
  assert.match(desktop, /fill="#F7F8FA"/);
});

test('packaging consumes the reviewed 1024px RGBA desktop icon', () => {
  const builder = read('desktop/electron-builder.yml').toString('utf8');
  const icon = read('assets/images/desktop-icon.png');

  assert.match(builder, /^\s+icon: \.\.\/assets\/images\/desktop-icon\.png$/m);
  assert.equal(icon.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
  assert.equal(icon[25], 6, 'desktop icon must retain RGBA transparency');
  assert.equal(
    createHash('sha256').update(icon).digest('hex'),
    '4390e3f718d2ff1bc40e05ebfeba8d5925008b20ca1138175f3f87e5321d6349',
  );
});

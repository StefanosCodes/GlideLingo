import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePlaywrightServerConfig } from './playwright-server-config.mjs';

const { host, port } = resolvePlaywrightServerConfig();
const distRoot = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
/** @type {Record<string, string>} */
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    else if (pathname.endsWith('/')) pathname += 'index.html';
    else if (!extname(pathname)) pathname += '.html';

    const requestedPath = resolve(distRoot, `.${pathname}`);
    if (!requestedPath.startsWith(`${distRoot}${sep}`)) {
      response.writeHead(400).end('Bad request');
      return;
    }

    try {
      const body = await readFile(requestedPath);
      const contentType = contentTypes[extname(requestedPath)] ?? 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }).end(body);
    } catch {
      const body = await readFile(resolve(distRoot, '404.html'));
      response.writeHead(404, { 'Content-Type': contentTypes['.html'], 'Cache-Control': 'no-store' }).end(body);
    }
  } catch {
    response.writeHead(400).end('Bad request');
  }
});

server.listen(port, host, () => {
  console.log(`Serving static output at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

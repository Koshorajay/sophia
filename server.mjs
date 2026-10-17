import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './src/app.mjs';

const root = dirname(fileURLToPath(import.meta.url)),
  publicDir = resolve(root, 'public');
const app = createApplication();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 16384) {
          res.writeHead(413);
          res.end('Request too large');
          return;
        }
      }
      const result = await app.handle({
        method: req.method,
        path: url.pathname,
        headers: req.headers,
        body: body || {},
        ip: req.socket.remoteAddress,
      });
      res.writeHead(result.status, result.headers);
      res.end(result.body);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    const target = resolve(publicDir, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!target.startsWith(publicDir + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let content;
    try {
      content = await readFile(target);
    } catch {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': mime[extname(target)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(500);
    res.end('The server could not complete this request.');
  }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Sophia is ready at http://localhost:${server.address().port} (${process.env.SOPHIA_PROVIDER === 'bedrock' ? 'Amazon Bedrock' : 'local demo'})`,
  ),
);
process.on('SIGTERM', () => server.close());

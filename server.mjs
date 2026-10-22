import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './src/app.mjs';
import { serveStatic } from './src/static.mjs';

const root = dirname(fileURLToPath(import.meta.url)),
  publicDir = resolve(root, 'public');
const app = createApplication();
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
    const file = await serveStatic(publicDir, url.pathname, req.method);
    res.writeHead(file.status, file.headers);
    res.end(file.body);
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

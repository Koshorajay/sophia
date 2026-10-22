/** Serves the web app's files from public/. Used by the local server, and by Lambda when there is no CloudFront. */
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

/** Returns { status, headers, body: Buffer } for a GET/HEAD of pathname, confined to publicDir. */
export async function serveStatic(publicDir, pathname, method = 'GET', { cacheSeconds = 0 } = {}) {
  if (method !== 'GET' && method !== 'HEAD') return { status: 405, headers: {}, body: Buffer.alloc(0) };
  let decoded;
  try {
    decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    return { status: 400, headers: {}, body: Buffer.from('Bad request') };
  }
  const root = resolve(publicDir);
  const target = resolve(root, '.' + decoded);
  if (!target.startsWith(root + sep)) return { status: 403, headers: {}, body: Buffer.alloc(0) };
  let content;
  try {
    content = await readFile(target);
  } catch {
    return { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: Buffer.from('Not found') };
  }
  const html = extname(target) === '.html';
  return {
    status: 200,
    headers: {
      'content-type': MIME[extname(target)] || 'application/octet-stream',
      // The page itself always revalidates so a new deploy shows up; assets may be cached briefly.
      'cache-control': html || !cacheSeconds ? 'no-cache' : `public, max-age=${cacheSeconds}`,
      ...SECURITY_HEADERS,
    },
    body: method === 'HEAD' ? Buffer.alloc(0) : content,
  };
}

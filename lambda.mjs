import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './src/app.mjs';
import { serveStatic } from './src/static.mjs';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const isApi = path => path === '/api' || path.startsWith('/api/') || path === '/mcp';

export function createLambdaHandler(app = createApplication(), { staticDir = publicDir } = {}) {
  return async function handler(event = {}) {
    const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
    const path = event.rawPath || event.path || '/';
    // Without CloudFront, API Gateway sends every path here, so the web app is served too.
    if (!isApi(path)) {
      const file = await serveStatic(staticDir, path, method, { cacheSeconds: 300 });
      return {
        statusCode: file.status,
        headers: file.headers,
        body: file.body.toString('base64'),
        isBase64Encoded: true,
      };
    }
    const headers = { ...event.headers };
    if (event.cookies?.length) headers.cookie = event.cookies.join('; ');
    const result = await app.handle({
      method,
      path,
      headers,
      body: event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : {},
      ip: event.requestContext?.http?.sourceIp,
    });
    const response = {
      statusCode: result.status,
      headers: { ...result.headers },
      body: result.body,
      isBase64Encoded: false,
    };
    if (response.headers['set-cookie']) {
      response.cookies = [response.headers['set-cookie']];
      delete response.headers['set-cookie'];
    }
    return response;
  };
}
export const handler = createLambdaHandler();

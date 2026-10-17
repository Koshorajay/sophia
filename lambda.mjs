import { createApplication } from './src/app.mjs';

export function createLambdaHandler(app = createApplication()) {
  return async function handler(event = {}) {
    const headers = { ...event.headers };
    if (event.cookies?.length) headers.cookie = event.cookies.join('; ');
    const result = await app.handle({
      method: event.requestContext?.http?.method || event.httpMethod || 'GET',
      path: event.rawPath || event.path || '/',
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

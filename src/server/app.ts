import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { apiPrefix, healthResponseSchema } from '../contracts/index';
import type { ApiError } from '../contracts/index';

export async function createApp(webRoot = resolve('dist/web')) {
  const app = Fastify({ logger: true });

  app.get('/healthz', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return healthResponseSchema.parse({ status: 'ok' });
  });

  if (existsSync(resolve(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: webRoot });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    const acceptsHtml = request.headers.accept?.includes('text/html');
    if (!isApi && request.method === 'GET' && acceptsHtml && existsSync(resolve(webRoot, 'index.html'))) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }

    const body: ApiError = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };
    return reply.code(404).send(body);
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request failed');
    const body: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Request failed' } };
    return reply.code(500).send(body);
  });

  app.log.info({ apiPrefix }, 'API namespace reserved');
  return app;
}

import Fastify, { LogController } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { apiPrefix, healthResponseSchema } from '../contracts/index';
import type { ApiError } from '../contracts/index';
import type { AuthService } from './auth/service';
import { registerAuthRoutes } from './auth/routes';
import { registerSharingRoutes } from './sharing/routes';
import type { SharingOptions } from './sharing/routes';

export async function createApp(webRoot = resolve('dist/web'), auth?: AuthService, logger = true, sharingOptions?: SharingOptions) {
  const app = Fastify({ logger, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 65536 });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (path.startsWith('/api/v1/auth') || path.startsWith('/auth/')) {
      reply.header('Cache-Control', 'no-store');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    }
  });
  if (auth) {
    await registerAuthRoutes(app, auth);
    await registerSharingRoutes(app, auth, sharingOptions);
    auth.startDeliveries(() => app.log.warn('Login email delivery failed'));
    app.addHook('onClose', async () => { await auth.close(); });
  }

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
      return reply.header('Cache-Control', pathname.startsWith('/auth/') ? 'no-store' : 'no-cache').sendFile('index.html');
    }

    const body: ApiError = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };
    return reply.code(404).send(body);
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? error.statusCode
      : undefined;
    if (typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
      const message = STATUS_CODES[statusCode] ?? 'Invalid request';
      const body: ApiError = {
        error: { code: message.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_'), message },
      };
      return reply.code(statusCode).send(body);
    }

    request.log.error('Request failed');
    const body: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Request failed' } };
    return reply.code(500).send(body);
  });

  app.log.info({ apiPrefix }, 'API namespace reserved');
  return app;
}

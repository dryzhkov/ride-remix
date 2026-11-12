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
import { clientIpResolver, TrafficLimiter } from './security';
import type { SecurityOptions } from './security';
import type { SharingOptions } from './sharing/routes';

export async function createApp(webRoot = resolve('dist/web'), auth?: AuthService, logger = true, sharingOptions?: SharingOptions, security: SecurityOptions = {}) {
  const app = Fastify({
    logger, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 65536,
    requestTimeout: 15000, connectionTimeout: 10000, keepAliveTimeout: 5000, maxRequestsPerSocket: 100,
  });
  const resolveIp = clientIpResolver(security);
  const traffic = new TrafficLimiter(security);
  let concurrent = 0;
  const events = new Map<string, { count: number; loggedAt: number }>();
  const audit = (event: string) => {
    const previous = events.get(event) ?? { count: 0, loggedAt: 0 };
    previous.count++;
    if (Date.now() - previous.loggedAt >= 60_000) {
      app.log.warn({ event, count: previous.count }, 'Security admission event');
      previous.loggedAt = Date.now(); previous.count = 0;
    }
    events.set(event, previous);
  };
  app.decorateRequest('clientIp', '');
  app.decorateRequest('countedRequest', false);
  const release = (request: { countedRequest: boolean }) => {
    if (request.countedRequest) { request.countedRequest = false; concurrent--; }
  };
  app.addHook('onRequestAbort', async request => release(request));
  app.addHook('onTimeout', async request => release(request));
  app.addHook('onResponse', async (request, reply) => {
    release(request);
    if (reply.statusCode === 429) audit('rate_limited');
  });

  // Static-file delivery can overwrite headers set before sendFile runs.
  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.url.split('?')[0];
    if (path.startsWith('/api/') || path.startsWith('/auth/') || /^\/invite\/?$/.test(path)) {
      reply.header('Cache-Control', 'no-store');
    } else if (path === '/sw.js' || String(reply.getHeader('Content-Type')).includes('text/html')) {
      reply.header('Cache-Control', 'no-cache');
    }
    return payload;
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    const path = request.url.split('?')[0];
    if (path.startsWith('/api/') || path.startsWith('/auth/') || /^\/invite\/?$/.test(path)) reply.header('Cache-Control', 'no-store');
    const ip = path === '/healthz' ? request.raw.socket.remoteAddress : resolveIp(request);
    if (!ip) { audit('untrusted_proxy'); return reply.code(403).send({ error: { code: 'INVALID_PROXY', message: 'Request route is unavailable' } }); }
    request.clientIp = ip;
    if (path !== '/healthz' && !traffic.allow(ip)) return reply.header('Retry-After', '60').code(429).send({ error: { code: 'RATE_LIMITED', message: 'Please try again later' } });
    if (concurrent >= (security.maxConcurrent ?? 100)) { audit('concurrency_limit'); return reply.header('Retry-After', '5').code(503).send({ error: { code: 'BUSY', message: 'Please try again shortly' } }); }
    concurrent++; request.countedRequest = true;
  });
  if (auth) {
    await registerAuthRoutes(app, auth);
    await registerSharingRoutes(app, auth, sharingOptions);
    auth.startDeliveries(() => audit('email_delivery_failed'), audit);
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
      return reply.header('Cache-Control', (pathname.startsWith('/auth/') || /^\/invite\/?$/.test(pathname)) ? 'no-store' : 'no-cache').sendFile('index.html');
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

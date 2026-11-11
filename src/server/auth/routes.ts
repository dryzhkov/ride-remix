import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loginLinkRequestSchema, loginLinkResponseSchema, redeemRequestSchema, redeemResponseSchema, sessionResponseSchema } from '../../contracts/auth';
import type { AuthService } from './service';
import { SESSION_LIFETIME } from './store';

export const SESSION_COOKIE = '__Host-ride_session';
const error = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });
export function readSessionCookie(request: FastifyRequest): string | undefined {
  const values = (request.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${SESSION_COOKIE}=`));
  return values.length === 1 ? values[0].slice(SESSION_COOKIE.length + 1) : undefined;
}
export function requireSession(auth: AuthService, request: FastifyRequest, reply: FastifyReply) {
  const session = auth.store.session(readSessionCookie(request), auth.now());
  if (session.status !== 'ok') {
    if (session.status === 'revoked') error(reply, 403, 'ACCESS_REVOKED', 'Access is unavailable');
    else error(reply, 401, 'UNAUTHENTICATED', 'Sign in to continue');
    return;
  }
  return session;
}
export function requireSameOrigin(auth: AuthService, request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.headers.origin !== auth.origin || request.headers['sec-fetch-site'] === 'cross-site') {
    error(reply, 403, 'INVALID_ORIGIN', 'Request origin is not allowed'); return false;
  }
  return true;
}
export function requireCsrf(expected: string, request: FastifyRequest, reply: FastifyReply): boolean {
  const actual = request.headers['x-csrf-token'];
  if (typeof actual !== 'string' || !/^[a-f0-9]{64}$/.test(actual) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    error(reply, 403, 'INVALID_CSRF', 'Refresh your sign-in session and try again'); return false;
  }
  return true;
}
export async function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  app.post('/api/v1/auth/login-links', { bodyLimit: 2048 }, async (request, reply) => {
    if (!requireSameOrigin(auth, request, reply)) return;
    const input = loginLinkRequestSchema.safeParse(request.body);
    if (!input.success) return error(reply, 422, 'INVALID_EMAIL', 'Enter a valid email address');
    if (!auth.allowLogin(request.ip, input.data.email)) return error(reply, 429, 'RATE_LIMITED', 'Please try again later');
    // Do not expose eligibility, global delivery quota, or provider failure to callers.
    auth.queueLink(input.data.email);
    return reply.code(202).send(loginLinkResponseSchema.parse({ message: 'If this email is eligible, a sign-in link will arrive shortly.' }));
  });
  app.post('/api/v1/auth/redeem', { bodyLimit: 2048 }, async (request, reply) => {
    if (!requireSameOrigin(auth, request, reply)) return;
    if (!auth.allowRedeem(request.ip)) return error(reply, 429, 'RATE_LIMITED', 'Please try again later');
    const input = redeemRequestSchema.safeParse(request.body);
    const redemption = input.success ? auth.store.redeem(input.data.token, auth.now()) : undefined;
    if (!redemption) return error(reply, 400, 'INVALID_LOGIN_LINK', 'This link is invalid or expired. Request a new sign-in link.');
    reply.header('Set-Cookie', `${SESSION_COOKIE}=${redemption.secret}; Path=/; Max-Age=${SESSION_LIFETIME / 1000}; Secure; HttpOnly; SameSite=Lax`);
    return redeemResponseSchema.parse({ account: redemption.account, csrfToken: redemption.csrfToken });
  });
  app.get('/api/v1/auth/session', async (request, reply) => {
    const session = requireSession(auth, request, reply);
    if (!session) return;
    return sessionResponseSchema.parse({ account: session.account, expiresAt: session.expiresAt, csrfToken: session.csrfToken });
  });
  app.post('/api/v1/auth/logout', { bodyLimit: 2048 }, async (request, reply) => {
    if (!requireSameOrigin(auth, request, reply)) return;
    const session = requireSession(auth, request, reply);
    if (!session || !requireCsrf(session.csrfToken, request, reply)) return;
    auth.store.logout(readSessionCookie(request)!, auth.now());
    reply.header('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
    return reply.code(204).send();
  });
}

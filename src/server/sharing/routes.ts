import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/service';
import { requireCsrf, requireSameOrigin, requireSession } from '../auth/routes';
import { publicationResponseSchema, publicIdSchema, publishRequestSchema, sharingLimits } from '../../contracts/sharing';
import { PublicationConflict, PublicationQuotaExceeded, SharingStore } from './store';
import type { PublicationQuotas } from './store';

export interface SharingOptions { quotas?: PublicationQuotas; accountPerHour?: number; ipPerHour?: number; bodyBytes?: number }
export async function registerSharingRoutes(app: FastifyInstance, auth: AuthService, options: SharingOptions = {}) {
  const store = new SharingStore(auth.store.db, options.quotas);
  app.post('/api/v1/shared-decks', { bodyLimit: options.bodyBytes ?? sharingLimits.bodyBytes }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!requireSameOrigin(auth, request, reply)) return;
    const session = requireSession(auth, request, reply);
    if (!session || !requireCsrf(session.csrfToken, request, reply)) return;
    if (!auth.store.allow([
      { key: `publish:account:${session.account.id}`, limit: options.accountPerHour ?? 10, window: 60 * 60_000 },
      { key: `publish:ip:${request.clientIp}`, limit: options.ipPerHour ?? 30, window: 60 * 60_000 },
    ], auth.now())) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Publishing limit reached. Try again later.' } });
    const parsed = publishRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: { code: 'INVALID_SNAPSHOT', message: 'This deck exceeds sharing limits or contains unsupported content.' } });
    try {
      const snapshot = store.publish(session.account.id, parsed.data, auth.now());
      request.log.info('Deck snapshot published');
      return reply.code(201).send(publicationResponseSchema.parse({ id: snapshot.id, createdAt: snapshot.createdAt, payloadVersion: 1, url: `${auth.origin}/s/${snapshot.id}` }));
    } catch (error) {
      if (error instanceof PublicationConflict) return reply.code(409).send({ error: { code: 'REQUEST_CONFLICT', message: 'This publication request already contains a different snapshot. Start a new publication.' } });
      if (error instanceof PublicationQuotaExceeded) return reply.code(429).send({ error: { code: 'STORAGE_QUOTA', message: 'Publication storage limit reached.' } });
      throw error;
    }
  });
  app.get<{ Params: { id: string } }>('/api/v1/shared-decks/:id', async (request, reply) => {
    // Unsaved public links always use the network, including after operator deletion.
    reply.header('Cache-Control', 'no-store');
    const id = publicIdSchema.safeParse(request.params.id);
    const snapshot = id.success ? store.get(id.data) : undefined;
    if (!snapshot) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'This shared deck is unavailable.' } });
    return snapshot;
  });
}

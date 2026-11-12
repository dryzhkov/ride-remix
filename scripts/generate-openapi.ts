import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { apiErrorSchema, healthResponseSchema } from '../src/contracts';
import { accessRequestSchema, accessResponseSchema, challengeConfigSchema, authFixtures, loginLinkRequestSchema, loginLinkResponseSchema, redeemRequestSchema, redeemResponseSchema, sessionResponseSchema } from '../src/contracts/auth';

import { publicationResponseSchema, publicIdSchema, publishRequestSchema, sharedDeckResponseSchema, sharingFixtures, sharingLimits } from '../src/contracts/sharing';

const json = (name: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } });
const response = (description: string, schema = 'ApiError') => ({ description, content: json(schema) });
const origin = { name: 'Origin', in: 'header', required: true, schema: { type: 'string', format: 'uri' }, description: 'Must match configured public application origin.' };
const body = (schema: string) => ({ required: true, content: json(schema) });
const authErrors = { '401': response('Missing or expired session'), '403': response('Revoked access or invalid origin/CSRF token') };
const writeErrors = { '400': response('Malformed JSON'), '413': response('Body exceeds the endpoint’s configured body-size limit'), '429': response('Rate limit reached') };
const schemas = { AccessRequest: accessRequestSchema, AccessResponse: accessResponseSchema, ChallengeConfig: challengeConfigSchema, HealthResponse: healthResponseSchema, ApiError: apiErrorSchema, LoginLinkRequest: loginLinkRequestSchema,
  LoginLinkResponse: loginLinkResponseSchema, RedeemRequest: redeemRequestSchema, RedeemResponse: redeemResponseSchema, AuthSessionResponse: sessionResponseSchema, PublishRequest: publishRequestSchema, PublicationResponse: publicationResponseSchema, SharedDeckResponse: sharedDeckResponseSchema };
const document = {
  openapi: '3.1.0',
  info: { title: 'Ride Remix API', version: '1.0.0', description: 'Health, invite-only authentication, and immutable snapshot sharing are implemented. All auth responses use Cache-Control: no-store. Protected writes require same-origin Origin and X-CSRF-Token. Login links carry secrets in fragments; GET never consumes them.' },
  paths: {
    '/healthz': { get: { operationId: 'getHealth', responses: { '200': response('Process is healthy', 'HealthResponse') } } },
    '/api/v1/auth/challenge-config': { get: { operationId: 'getChallengeConfig', responses: { '200': response('Public Turnstile site key; null when verification is unavailable', 'ChallengeConfig') } } },
    '/api/v1/auth/access-requests': { post: { operationId: 'requestAccess', parameters: [origin], requestBody: body('AccessRequest'), responses: { '202': response('Generic receipt; pending email requires manual approval', 'AccessResponse'), ...writeErrors, '400': response('Verification failed, expired, or already used'), '403': response('Invalid origin'), '422': response('Invalid request') } } },
    '/api/v1/auth/login-links': { post: { operationId: 'requestLoginLink', parameters: [origin], requestBody: body('LoginLinkRequest'), responses: { '202': { ...response('Generic response regardless of account eligibility or email-provider failure', 'LoginLinkResponse'), content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginLinkResponse' }, example: authFixtures.loginResponse } } }, ...writeErrors, '400': response('Verification failed, expired, or already used'), '403': response('Invalid origin'), '422': response('Invalid email or unexpected fields') } } },
    '/api/v1/auth/redeem': { post: { operationId: 'redeemLoginLink', parameters: [origin], requestBody: body('RedeemRequest'), responses: { ...writeErrors, '200': { ...response('Token consumed atomically; invited account activated', 'RedeemResponse'), headers: { 'Set-Cookie': { description: '__Host-ride_session opaque cookie; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; no Domain', schema: { type: 'string' } } } }, '400': response('Invalid, expired, or used link'), '403': response('Invalid origin') } } },
    '/api/v1/auth/session': { get: { operationId: 'getAuthSession', security: [{ sessionCookie: [] }], responses: { '200': response('Current account, absolute expiry, and CSRF token', 'AuthSessionResponse'), ...authErrors } } },
    '/api/v1/shared-decks': { post: { operationId: 'publishSharedDeck', security: [{ sessionCookie: [] }], parameters: [origin, { name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } }], requestBody: body('PublishRequest'), responses: {
      '201': { ...response('Immutable publication; identical account/request/payload retries return the original result', 'PublicationResponse'), content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicationResponse' }, example: sharingFixtures.publication } } },
      ...authErrors, '400': response('Malformed JSON'), '409': response('Same account/request ID already has a different payload'), '413': response(`Request body exceeds ${sharingLimits.bodyBytes} bytes`), '422': response('Unsupported payload version, invalid content, or deck bounds exceeded'), '429': response('Account/IP rate or publication storage quota reached'),
    } } },
    '/api/v1/shared-decks/{id}': { get: { operationId: 'getSharedDeck', parameters: [{ name: 'id', in: 'path', required: true, schema: z.toJSONSchema(publicIdSchema) }], responses: { '200': response('Public immutable snapshot without publisher identity/history; no-store', 'SharedDeckResponse'), '404': response('Missing or operator-deleted publication'), '429': response('Public request rate reached') } } },
    '/api/v1/auth/logout': { post: { operationId: 'logout', security: [{ sessionCookie: [] }], parameters: [origin, { name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } }], responses: { '204': { description: 'Current session revoked and cookie cleared' }, ...authErrors, '413': writeErrors['413'] } } },
  },
  components: {
    schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema)])),
    securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: '__Host-ride_session', description: 'Opaque server-side session. Protected writes also require same-origin Origin and X-CSRF-Token.' } },
  },
  'x-planned-operations': [],
};
writeFileSync('openapi.json', JSON.stringify(document, null, 2) + '\n');

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiErrorSchema } from '../contracts/index';
import { createApp } from './app';

test('malformed JSON returns a structured 400 response', async (t) => {
  const app = await createApp();
  t.after(() => app.close());
  app.post('/api/v1/test', async () => ({ ok: true }));

  const response = await app.inject({
    method: 'POST', url: '/api/v1/test',
    headers: { 'content-type': 'application/json' }, payload: '{',
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(apiErrorSchema.parse(response.json()), {
    error: { code: 'BAD_REQUEST', message: 'Bad Request' },
  });
});

test('oversized JSON returns a structured 413 response', async (t) => {
  const app = await createApp();
  t.after(() => app.close());
  app.post('/api/v1/test', { bodyLimit: 32 }, async () => ({ ok: true }));

  const response = await app.inject({
    method: 'POST', url: '/api/v1/test',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ value: 'x'.repeat(33) }),
  });

  assert.equal(response.statusCode, 413);
  assert.deepEqual(apiErrorSchema.parse(response.json()), {
    error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload Too Large' },
  });
});

test('unexpected failures return a generic 500 without internal details', async (t) => {
  const app = await createApp();
  t.after(() => app.close());
  app.get('/api/v1/test', async () => {
    throw new Error('Private database connection details');
  });

  const response = await app.inject('/api/v1/test');

  assert.equal(response.statusCode, 500);
  assert.deepEqual(apiErrorSchema.parse(response.json()), {
    error: { code: 'INTERNAL_ERROR', message: 'Request failed' },
  });
});

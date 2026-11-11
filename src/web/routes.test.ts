import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute } from './routes';

test('route parser separates deck library, generation and stable entity URLs', () => {
  const id = '133d5619-1234-4567-89ab-0123456789ab';
  assert.deepEqual(parseRoute('/'), { page: 'deck', mode: 'list' });
  assert.deepEqual(parseRoute('/deck/'), { page: 'deck', mode: 'list' });
  assert.deepEqual(parseRoute('/deck/new'), { page: 'deck', mode: 'new' });
  assert.deepEqual(parseRoute(`/deck/${id}`), { page: 'deck', mode: 'detail', id });
  assert.deepEqual(parseRoute('/practice'), { page: 'practice' });
  assert.deepEqual(parseRoute(`/practice/${id}`), { page: 'practice', id });
  assert.deepEqual(parseRoute('/history'), { page: 'history' });
  assert.deepEqual(parseRoute('/settings'), { page: 'settings' });
  assert.deepEqual(parseRoute('/s/public-id'), { page: 'shared', id: 'public-id' });
});

test('malformed and unknown routes do not resolve to unrelated local entities', () => {
  for (const path of ['/deck/missing', '/deck/new/extra', '/practice/%', '/practice/new', '/missing', '/settings/extra']) {
    assert.deepEqual(parseRoute(path), { page: 'missing' });
  }
});

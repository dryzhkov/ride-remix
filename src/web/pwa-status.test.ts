import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { PracticeRepository } from '../domain/repository';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    const loaded = nextLoad(url, context);
    if (url.includes('/pwa/PwaStatus.tsx') && loaded.source) return { ...loaded, source: String(loaded.source).replaceAll('import.meta.env?.PROD', 'true') };
    return loaded;
  },
});

test('update checks show progress, block duplicate taps, count down, and report failure, timeout and available updates', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://ride.test/settings' });
  let calls = 0;
  let update = () => Promise.resolve();
  const registration = { waiting: null as object | null, installing: null,
    addEventListener() {}, async update() { calls++; await update(); } };
  const globals = { window: dom.window, document: dom.window.document,
    navigator: { serviceWorker: { controller: null, addEventListener() {}, removeEventListener() {}, async register() { return registration; } } }, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.now() });
  const { PwaStatus } = await import('./pwa/PwaStatus');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const repository = { listSessions: async () => [] } as unknown as PracticeRepository;
  const button = () => [...container.querySelectorAll('button')].find(button => button.textContent !== 'Apply update')!;
  async function tick(ms: number) { await act(async () => { t.mock.timers.tick(ms); }); }
  try {
    await act(async () => { root.render(createElement(PwaStatus, { repository, onStatus: () => {} })); });
    assert.equal(button().textContent, 'Check for updates');
    let finish!: () => void;
    update = () => new Promise(resolve => { finish = resolve; });
    await act(async () => { button().click(); button().click(); });
    assert.equal(calls, 1);
    assert.equal(button().textContent, 'Checking…');
    assert.equal(button().getAttribute('aria-busy'), 'true');
    assert.equal(button().disabled, true);
    await act(async () => { finish(); });
    assert.match(container.textContent!, /No new update found/);
    assert.equal(button().textContent, 'Check again in 30s');
    await tick(1000);
    assert.equal(button().textContent, 'Check again in 29s');
    await act(async () => { button().click(); });
    assert.equal(calls, 1);
    await tick(29000);
    assert.equal(button().disabled, false);
    update = async () => { throw new Error('Offline'); };
    await act(async () => { button().click(); });
    assert.match(container.querySelector('[role="alert"]')!.textContent!, /Could not check/);
    assert.equal(button().disabled, true);
    await tick(30000);
    update = () => new Promise(() => {});
    await act(async () => { button().click(); });
    await tick(15000);
    assert.match(container.querySelector('[role="alert"]')!.textContent!, /timed out/);
    await tick(30000);
    registration.waiting = {};
    update = async () => {};
    await act(async () => { button().click(); });
    assert.match(container.textContent!, /Update ready/);
    assert.ok([...container.querySelectorAll('button')].some(button => button.textContent === 'Apply update'));
    assert.equal(container.querySelector('[role="alert"]'), null);
  } finally {
    await act(async () => { root.unmount(); });
    t.mock.timers.reset(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

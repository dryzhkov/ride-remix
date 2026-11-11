import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { openPracticeRepository } from '../repositories/indexed-db';
import { authFixtures } from '../contracts/auth';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    const loaded = nextLoad(url, context);
    // Exercise the production-only registration branch in the DOM harness.
    if (url.includes('/pwa/PwaStatus.tsx') && loaded.source) {
      return { ...loaded, source: String(loaded.source).replaceAll('import.meta.env?.PROD', 'true') };
    }
    return loaded;
  },
});

test('application entry connects practice, sharing, recovery and production worker registration', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://ride.test/' });
  let registrations = 0;
  const serviceWorker = {
    controller: null,
    addEventListener() {}, removeEventListener() {},
    async register(url: string) {
      assert.equal(url, '/sw.js'); registrations++;
      return { waiting: null, addEventListener() {}, async update() {} };
    },
  };
  const originalFetch = globalThis.fetch;
  const publicId = 'a'.repeat(32);
  let published = false;
  let sharedDeck: unknown;
  const globals = { navigator: { serviceWorker }, localStorage: dom.window.localStorage,
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      if (url === '/api/v1/auth/session') return Response.json(authFixtures.session);
      if (url === '/api/v1/shared-decks' && init?.method === 'POST') {
        assert.equal(new Headers(init.headers).get('X-CSRF-Token'), authFixtures.session.csrfToken);
        sharedDeck = JSON.parse(String(init.body)).deck;
        published = true;
        return Response.json({ id: publicId, url: `https://ride.test/s/${publicId}`, createdAt: new Date().toISOString(), payloadVersion: 1 }, { status: 201 });
      }
      if (url === `/api/v1/shared-decks/${publicId}`) return Response.json({ id: publicId, createdAt: new Date().toISOString(), payloadVersion: 1, deck: sharedDeck });
      return originalFetch(url, init);
    }, window: dom.window, document: dom.window.document, location: dom.window.location,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { App } = await import('./App');
  const container = dom.window.document.getElementById('root')!;
  let root = createRoot(container);
  const repository = await openPracticeRepository();
  async function settle(predicate: () => boolean) {
    for (let attempt = 0; attempt < 100; attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      if (predicate()) return;
    }
    assert.fail(`UI did not settle: ${container.textContent}`);
  }
  async function click(label: string) {
    const button = [...container.querySelectorAll('button')].find(button => button.textContent === label);
    assert.ok(button, `Missing button ${label}`);
    assert.equal(button.disabled, false, `Disabled button ${label}`);
    await act(async () => { button.click(); });
  }
  try {
    await act(async () => { root.render(createElement(StrictMode, null, createElement(App))); });
    await settle(() => !!container.querySelector('.deck-screen fieldset:not(:disabled)'));
    await click('Generate new deck');
    await settle(() => [...container.querySelectorAll('button')].some(button => button.textContent === 'Start practice'));
    await click('Publish deck link');
    await settle(() => !!container.querySelector('.sharing-url'));
    assert.equal(published, true);
    assert.ok(registrations > 0);
    await click('Start practice');
    await settle(() => !!container.querySelector('.practice-drill'));
    assert.equal((await repository.listSessions()).length, 1);
    // A remount simulates reloading the app with an unfinished persisted session.
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await act(async () => { root.render(createElement(App)); });
    await settle(() => !!container.querySelector('.practice-drill'));
    for (let entry = 0; entry < 2; entry++) {
      await click('Done');
      await click('Getting consistent');
      await settle(() => !!container.querySelector(entry === 0 ? '.practice-drill' : '.practice-finish'));
    }
    await click('View history');
    await settle(() => !!container.querySelector('.history-sessions'));
    assert.match(container.textContent!, /2 done/);
    assert.equal((await repository.listResults()).length, 2);
    // History can build a deck and route to its editor.
    const checkbox = container.querySelector<HTMLInputElement>('.history-selection input')!;
    await act(async () => { checkbox.click(); });
    await click('Build next deck (1)');
    await settle(() => [...container.querySelectorAll('button')].some(button => button.textContent === 'Start practice' && !button.disabled));
    await click('History');
    await settle(() => !!container.querySelector('.history-sessions'));
    await click('Repeat this deck');
    await settle(() => !!container.querySelector('.practice-drill'));
    assert.equal((await repository.listSessions()).length, 2);
    await click('Backup and recovery');
    assert.ok(container.querySelector('.recovery-screen'));
    let download = '';
    dom.window.HTMLAnchorElement.prototype.click = function () { download = this.download; };
    await click('Download JSON backup');
    await settle(() => container.textContent!.includes('Backup download requested.'));
    assert.match(download, /^ride-remix-backup-.*\.json$/);
    // Restore a backup through the actual file-input handler and retain the report.
    const archive = JSON.stringify(await repository.exportArchive());
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [{ text: async () => archive }] });
    await act(async () => { input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await settle(() => container.textContent!.includes('Backup import finished.'));
    assert.ok(container.querySelector('[aria-label="Import report"]'));
    await click('Deck');
    await settle(() => !!container.querySelector('.sharing-publish'));
    // Direct shared links take precedence over resuming an existing session.
    await act(async () => { root.unmount(); });
    dom.window.history.replaceState(null, '', `/s/${publicId}`);
    root = createRoot(container);
    await act(async () => { root.render(createElement(App)); });
    await settle(() => !!container.querySelector('.shared-deck article'));
    const count = (await repository.listDecks()).length;
    await click('Save a copy');
    await settle(() => [...container.querySelectorAll('button')].some(button => button.textContent === 'Start practice' && !button.disabled));
    assert.equal(dom.window.location.pathname, '/');
    assert.equal((await repository.listDecks()).length, count + 1);
    assert.match(container.textContent!, /Start practice/);

  } finally {
    await act(async () => { root.unmount(); });
    repository.close();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

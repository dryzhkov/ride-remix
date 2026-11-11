import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { openPracticeRepository } from '../repositories/indexed-db';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});

test('application entry supports generate, start, resume, rate, history and repeat', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://ride.test/' });
  const globals = { window: dom.window, document: dom.window.document, location: dom.window.location,
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
    await settle(() => !!container.querySelector('.deck-screen'));
    await click('History');
    await settle(() => !!container.querySelector('.history-sessions'));
    await click('Repeat this deck');
    await settle(() => !!container.querySelector('.practice-drill'));
    assert.equal((await repository.listSessions()).length, 2);
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

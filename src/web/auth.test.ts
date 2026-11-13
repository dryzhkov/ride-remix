import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { accessResponseSchema } from '../contracts/auth';

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return nextLoad(url, context);
} });

test('access request UI requires verification and submits the action-bound token with email', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://ride.example.com/invite' });
  let complete: ((token: string) => void) | undefined;
  let renderedAction = '';
  dom.window.turnstile = {
    render(_element, options) { complete = options.callback; renderedAction = options.action; return 'widget'; },
    remove() {},
  };
  let submitted: unknown;
  let accessSubmissions = 0;
  let loginSubmissions = 0;
  const globals = {
    window: dom.window, document: dom.window.document, location: dom.window.location,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: unknown, init?: RequestInit) => {
      if (url === '/api/v1/auth/session') return Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, { status: 401 });
      if (url === '/api/v1/auth/challenge-config') return Response.json({ siteKey: 'public-key' });
      if (url === '/api/v1/auth/login-links') {
        loginSubmissions++;
        return Response.json({ message: 'If this email is eligible, a sign-in link will arrive shortly.' }, { status: 202 });
      }
      if (url === '/api/v1/auth/access-requests') {
        accessSubmissions++;
        submitted = JSON.parse(String(init?.body));
        return Response.json(accessResponseSchema.parse({ message: 'Your request has been received. Access requires approval. If already approved, request a sign-in link.' }), { status: 202 });
      }
      throw new Error(`Unexpected request ${url}`);
    },
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  const container = dom.window.document.getElementById('root')!;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(container);
  async function settle(predicate: () => boolean) {
    for (let attempt = 0; attempt < 100; attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      if (predicate()) return;
    }
    assert.fail(container.textContent!);
  }
  try {
    const { App } = await import('./App');
    await act(async () => { root.render(createElement(App)); });
    await settle(() => !!document.querySelector('script[src*="challenges.cloudflare.com"]'));
    await act(async () => { document.querySelector('script')!.dispatchEvent(new dom.window.Event('load')); });
    await settle(() => !!complete);
    assert.equal(renderedAction, 'access_request');
    assert.equal(container.querySelector('h1')?.textContent, 'Request access');
    assert.match(container.textContent!, /email you when you’re approved/);
    assert.equal(container.textContent!.includes('Back to decks'), false);
    const signin = container.querySelector('main a[href="/auth/login"]')!;
    assert.ok(signin.compareDocumentPosition(container.querySelector('form')!) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(container.querySelector('a[href="/auth/login"]'));
    const submit = container.querySelector<HTMLButtonElement>('button[type=submit]')!;
    assert.equal(submit.disabled, true);
    const input = container.querySelector<HTMLInputElement>('input[type=email]')!;
    await act(async () => {
      // React's controlled input receives a native value change from the DOM.
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'rider@example.com');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      complete!('verified-token');
    });
    assert.equal(submit.disabled, false);
    await act(async () => { container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    await settle(() => submitted !== undefined);
    assert.deepEqual(submitted, { email: 'rider@example.com', challengeToken: 'verified-token' });
    assert.equal(submit.disabled, true);
    await act(async () => {
      complete!('fresh-token');
      container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(submit.disabled, true);
    assert.equal(accessSubmissions, 1);
    assert.match(submit.textContent!, /Access requested/);
    assert.match(container.textContent!, /Access requires approval/);
    dom.window.history.replaceState(null, '', '/auth/login');
    await act(async () => { root.render(createElement(App, { key: 'login' })); });
    await settle(() => renderedAction === 'login');
    assert.equal(container.querySelector('h1')?.textContent, 'Sign in');
    assert.ok(container.querySelector('a[href="/invite"]'));
    assert.equal(container.querySelector('button[type=submit]')?.textContent, 'Email me a sign-in link');
    await act(async () => {
      complete!('login-token');
    });
    await act(async () => {
      const form = container.querySelector('form')!;
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle(() => loginSubmissions > 0);
    await act(async () => {
      complete!('another-token');
      container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(loginSubmissions, 1);
    assert.equal(container.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled, true);
    assert.match(container.querySelector('button[type=submit]')!.textContent!, /Link requested/);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

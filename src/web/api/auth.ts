import { apiErrorSchema } from '../../contracts';
import { loginLinkResponseSchema, redeemResponseSchema, sessionResponseSchema } from '../../contracts/auth';

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/v1/auth/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (response.status === 204) return undefined;
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new Error(parsed.success ? parsed.data.error.message : 'Sign-in is unavailable. Please try again.');
  }
  return body;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export async function requestLoginLink(email: string) { return loginLinkResponseSchema.parse(await request('login-links', post({ email }))); }
export async function redeemLoginLink(token: string) { return redeemResponseSchema.parse(await request('redeem', post({ token }))); }
export async function getAuthSession(signal?: AbortSignal) {
  return sessionResponseSchema.parse(await request('session', { signal }));
}
export async function logout(csrfToken: string) {
  await request('logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
}

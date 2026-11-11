import { apiErrorSchema } from '../../contracts';
import { publicationResponseSchema, publishRequestSchema, sharedDeckResponseSchema } from '../../contracts/sharing';
import type { PublishRequest } from '../../contracts/sharing';

export class SharingApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function read(response: Response) {
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new SharingApiError(parsed.success ? parsed.data.error.message : 'Sharing is unavailable. Please try again.', response.status);
  }
  return body;
}
export async function publishDeck(request: PublishRequest, csrfToken: string) {
  const input = publishRequestSchema.parse(request);
  const response = await fetch('/api/v1/shared-decks', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(input),
  });
  return publicationResponseSchema.parse(await read(response));
}
export async function getSharedDeck(publicId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/v1/shared-decks/${encodeURIComponent(publicId)}`, { credentials: 'omit', cache: 'no-store', signal });
  return sharedDeckResponseSchema.parse(await read(response));
}

import { apiErrorSchema, healthResponseSchema } from '../../contracts/index';
import type { HealthResponse } from '../../contracts/index';

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/healthz', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });

  const body: unknown = await response.json();
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new Error(error.success ? error.data.error.message : 'Service unavailable');
  }

  return healthResponseSchema.parse(body);
}

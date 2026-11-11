import { resolve } from 'node:path';
import { DisabledEmailSender, ResendEmailSender } from './email';
import { AuthService } from './service';
import { AuthStore } from './store';

export function authFromEnvironment() {
  const production = process.env.NODE_ENV === 'production';
  const origin = process.env.PUBLIC_ORIGIN ?? (production ? undefined : 'http://localhost:5173');
  if (!origin) throw new Error('PUBLIC_ORIGIN is required');
  if (production && !origin.startsWith('https://')) throw new Error('Production PUBLIC_ORIGIN must use HTTPS');
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if ((key && !from) || (!key && from)) throw new Error('Configure RESEND_API_KEY and EMAIL_FROM together');
  const store = new AuthStore(resolve(process.env.DATABASE_PATH ?? 'data/ride-remix.sqlite'));
  try {
    return new AuthService(store, key && from ? new ResendEmailSender(key, from) : new DisabledEmailSender(), origin);
  } catch (error) { store.close(); throw error; }
}

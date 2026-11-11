import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const loginLinkRequestSchema = z.strictObject({ email: emailSchema });
export const loginLinkResponseSchema = z.strictObject({ message: z.literal('If this email is eligible, a sign-in link will arrive shortly.') });
export const redeemRequestSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const accountSchema = z.strictObject({ id: z.uuid(), email: emailSchema });
export const redeemResponseSchema = z.strictObject({ account: accountSchema, csrfToken: z.string().regex(/^[a-f0-9]{64}$/) });
export const sessionResponseSchema = redeemResponseSchema.extend({ expiresAt: z.iso.datetime() });
export type AuthAccount = z.infer<typeof accountSchema>;
export type AuthSessionResponse = z.infer<typeof sessionResponseSchema>;
export const authFixtures = {
  loginRequest: { email: 'rider@example.com' },
  loginResponse: { message: 'If this email is eligible, a sign-in link will arrive shortly.' },
  session: { account: { id: 'bbf259de-c01c-40bb-b45c-c6fb876d3ab3', email: 'rider@example.com' }, expiresAt: '2026-12-10T00:00:00.000Z', csrfToken: 'a'.repeat(64) },
} as const;

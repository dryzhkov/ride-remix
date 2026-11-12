import { z } from 'zod';

export type ChallengeAction = 'login' | 'access_request';
export interface ChallengeVerifier {
  verify(token: string, action: ChallengeAction, ip: string, now: number): Promise<boolean>;
}
const verificationSchema = z.object({
  success: z.boolean(), hostname: z.string().optional(), action: z.string().optional(), challenge_ts: z.string().optional(),
});
/** The provider rejects reused tokens; the store adds atomic local replay protection. */
export class TurnstileVerifier implements ChallengeVerifier {
  constructor(private secret: string, private hostname: string, private request: typeof fetch = fetch) {}
  async verify(token: string, action: ChallengeAction, ip: string, now: number) {
    try {
      const response = await this.request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: this.secret, response: token, remoteip: ip }),
      });
      if (!response.ok) return false;
      const result = verificationSchema.parse(await response.json());
      const age = now - Date.parse(result.challenge_ts ?? '');
      return result.success && result.hostname === this.hostname && result.action === action && age >= -30_000 && age <= 300_000;
    } catch { return false; }
  }
}

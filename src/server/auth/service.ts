import { AuthStore, LOGIN_LIFETIME } from './store';
import type { LoginEmailSender } from './email';

export interface AuthLimits {
  loginIp: number; loginEmail: number; redeemIp: number; emailPerDay: number;
}
export const defaultAuthLimits: AuthLimits = { loginIp: 20, loginEmail: 3, redeemIp: 30, emailPerDay: 100 };
export class AuthService {
  readonly origin: string;
  private deliveryWork?: Promise<void>;
  private closing = false;
  private reportDeliveryFailure: () => void = () => {};

  startDeliveries(reportFailure: () => void) {
    this.reportDeliveryFailure = reportFailure;
    this.scheduleDeliveries();
  }
  queueLink(email: string): void {
    if (!this.closing && this.store.enqueueDelivery(email, this.now())) this.scheduleDeliveries();
  }
  private scheduleDeliveries() {
    if (this.deliveryWork || this.closing) return;
    this.deliveryWork = new Promise<void>(resolve => setImmediate(resolve))
      .then(() => this.deliverQueuedLinks())
      .catch(() => { this.reportDeliveryFailure(); })
      .finally(() => { this.deliveryWork = undefined; });
  }
  private async deliverQueuedLinks() {
    while (!this.closing) {
      const job = this.store.nextDelivery();
      if (!job) return;
      if (job.requested_at > this.now() - LOGIN_LIFETIME) {
        if (await this.sendLink(job.email) === 'failed') this.reportDeliveryFailure();
      }
      this.store.completeDelivery(job.id);
    }
  }
  async waitForDeliveries(): Promise<void> { await this.deliveryWork; }
  async close(): Promise<void> {
    this.closing = true;
    await this.deliveryWork;
    this.store.close();
  }
  constructor(readonly store: AuthStore, private sender: LoginEmailSender, origin: string,
    readonly limits: AuthLimits = defaultAuthLimits, readonly now: () => number = Date.now) {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (localhost HTTP is permitted for development)');
    this.origin = url.origin;
  }
  allowLogin(ip: string, email: string) {
    return this.store.allow([
      { key: `login:ip:${ip}`, limit: this.limits.loginIp, window: LOGIN_LIFETIME },
      { key: `login:email:${email}`, limit: this.limits.loginEmail, window: LOGIN_LIFETIME },
    ], this.now());
  }
  allowRedeem(ip: string) {
    return this.store.allow([{ key: `redeem:ip:${ip}`, limit: this.limits.redeemIp, window: LOGIN_LIFETIME }], this.now());
  }
  async sendLink(email: string): Promise<'sent' | 'ineligible' | 'limited' | 'failed'> {
    // Delivery happens outside public request handling. Unknown/revoked emails never spend delivery quota.
    const account = this.store.account(email);
    if (!account || account.status === 'revoked') return 'ineligible';
    if (!this.store.allow([{ key: 'email:global', limit: this.limits.emailPerDay, window: 24 * 60 * 60_000 }], this.now())) return 'limited';
    const token = this.store.issue(email, this.now());
    if (!token) return 'ineligible';
    try {
      // Fragment secrets are never sent in HTTP request URLs or Referer headers.
      await this.sender.sendLoginLink(email, `${this.origin}/auth/confirm#token=${token}`);
      return 'sent';
    } catch {
      this.store.discardToken(token);
      return 'failed';
    }
  }
}

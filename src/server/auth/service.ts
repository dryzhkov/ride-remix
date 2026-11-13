import { AuthStore, LOGIN_LIFETIME } from './store';
import type { ChallengeAction, ChallengeVerifier } from './challenge';
import type { LoginEmailSender } from './email';

export interface AuthLimits {
  loginIp: number; loginEmail: number; redeemIp: number; emailPerDay: number;
}
export const defaultAuthLimits: AuthLimits = { loginIp: 20, loginEmail: 3, redeemIp: 30, emailPerDay: 100 };
export class AuthService {
  readonly origin: string;
  private deliveryWork?: Promise<void>;
  private closing = false;
  private poll?: ReturnType<typeof setInterval>;
  private reportDeliveryFailure: () => void = () => {};

  private audit: (event: string) => void = () => {};
  startDeliveries(reportFailure: () => void, audit: (event: string) => void = () => {}) {
    this.audit = audit;
    this.reportDeliveryFailure = reportFailure;
    this.scheduleDeliveries();
    if (!this.poll) { this.poll = setInterval(() => this.scheduleDeliveries(), 5000); this.poll.unref(); }
  }
  auditSecurity(event: string) { this.audit(event); }
  queueLink(email: string): void {
    if (!this.closing) {
      if (this.store.enqueueDelivery(email, this.now())) this.scheduleDeliveries();
      else this.audit('delivery_queue_full');
    }
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
      const approval = this.store.nextApproval(this.now());
      if (approval) {
        if (!['invited', 'active'].includes(approval.status)) {
          this.store.completeApproval(approval.account_id, this.now());
        } else if (!this.store.allow([{ key: 'email:global', limit: this.limits.emailPerDay, window: 24 * 60 * 60_000 }], this.now())) {
          this.store.postponeApproval(approval.account_id, this.now());
          this.audit('email_quota');
        } else {
          try {
            await this.sender.sendApprovalNotification(approval.email, `${this.origin}/auth/login`, `approval-${approval.account_id}-${approval.requested_at}`);
            this.store.completeApproval(approval.account_id, this.now());
          } catch {
            this.store.retryApproval(approval.account_id, this.now());
            this.reportDeliveryFailure();
          }
        }
        continue;
      }
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
    if (this.poll) clearInterval(this.poll);
    await this.deliveryWork;
    this.store.close();
  }
  constructor(readonly store: AuthStore, private sender: LoginEmailSender, origin: string,
    readonly limits: AuthLimits = defaultAuthLimits, readonly now: () => number = Date.now, readonly challenge?: { siteKey: string; verifier: ChallengeVerifier }) {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (localhost HTTP is permitted for development)');
    this.origin = url.origin;
  }
  async verifyChallenge(token: string, action: ChallengeAction, ip: string) {
    if (!this.challenge || !await this.challenge.verifier.verify(token, action, ip, this.now())) return false;
    return this.store.consumeChallenge(token, this.now());
  }
  allowAccess(ip: string, email: string) {
    return this.store.allow([
      { key: `access:ip:${ip}`, limit: 10, window: LOGIN_LIFETIME },
      { key: `access:email:${email}`, limit: 3, window: LOGIN_LIFETIME },
      { key: 'access:global', limit: 500, window: 60 * 60_000 },
    ], this.now());
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
    if (!account || !['invited', 'active'].includes(account.status)) return 'ineligible';
    if (!this.store.allow([{ key: 'email:global', limit: this.limits.emailPerDay, window: 24 * 60 * 60_000 }], this.now())) { this.audit('email_quota'); return 'limited'; }
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

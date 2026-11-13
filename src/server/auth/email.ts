export interface LoginEmailSender { sendLoginLink(email: string, url: string): Promise<void>; sendApprovalNotification(email: string, url: string, idempotencyKey: string): Promise<void> }

/** Provider failures never include provider responses (which may echo addresses or secrets). */
export class ResendEmailSender implements LoginEmailSender {
  constructor(private apiKey: string, private from: string) {}
  async sendLoginLink(email: string, url: string) {
    await this.send(email, 'Sign in to Ride Remix', `Sign in to Ride Remix by opening this link and selecting Continue:\n\n${url}\n\nThis link expires in 15 minutes and works once. If you did not request it, ignore this email.`);
  }
  async sendApprovalNotification(email: string, url: string, idempotencyKey: string) {
    await this.send(email, 'Your Ride Remix access is approved', `You’re approved for the Ride Remix beta.\n\nSign in with this email address to get started:\n${url}`, idempotencyKey);
  }
  private async send(email: string, subject: string, text: string, idempotencyKey?: string) {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        body: JSON.stringify({ from: this.from, to: [email], subject, text }),
      });
    } catch { throw new Error('Email delivery failed'); }
    if (!response.ok) throw new Error('Email delivery failed');
  }
}
export class DisabledEmailSender implements LoginEmailSender {
  async sendLoginLink(): Promise<void> { throw new Error('Email delivery is not configured'); }
  async sendApprovalNotification(): Promise<void> { throw new Error('Email delivery is not configured'); }
}

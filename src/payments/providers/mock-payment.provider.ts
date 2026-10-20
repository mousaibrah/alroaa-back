import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  Checkout,
  PaymentProvider,
} from '../types/payment-provider.types.js';

export const signPayload = (secret: string, body: Buffer | string): string =>
  createHmac('sha256', secret).update(body).digest('hex');

// Development gateway: hands out a checkout URL on the frontend and trusts
// webhooks signed with HMAC-SHA256 using PAYMENT_WEBHOOK_SECRET.
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  constructor(
    private readonly webhookSecret: string,
    private readonly checkoutBaseUrl: string,
  ) {}

  createCheckout(): Promise<Checkout> {
    const providerPaymentId = `mock_${randomUUID()}`;
    return Promise.resolve({
      providerPaymentId,
      checkoutUrl: this.checkoutUrl(providerPaymentId),
    });
  }

  checkoutUrl(providerPaymentId: string): string {
    return `${this.checkoutBaseUrl}/${providerPaymentId}`;
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = Buffer.from(signPayload(this.webhookSecret, rawBody));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

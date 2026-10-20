export interface CheckoutRequest {
  amount: number;
  currency: string;
  courseId: number;
  userId: number;
}

export interface Checkout {
  providerPaymentId: string;
  checkoutUrl: string;
}

// Gateway adapter. Swap `MockPaymentProvider` for a real one (Stripe,
// Paymob, ...) by implementing this interface and changing the provider in
// `payments.module.ts`.
export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<Checkout>;
  checkoutUrl(providerPaymentId: string): string;
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean;
}

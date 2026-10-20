import { Module } from '@nestjs/common';
import { PaymentsController } from './controllers/payments.controller.js';
import { PaymentsService } from './services/payments.service.js';
import { MockPaymentProvider } from './providers/mock-payment.provider.js';
import { PAYMENT_PROVIDER } from './constants/payment.constants.js';

const webhookSecret = (): string => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PAYMENT_WEBHOOK_SECRET must be set in production');
  }
  return 'dev-webhook-secret';
};

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: () =>
        new MockPaymentProvider(
          webhookSecret(),
          process.env.PAYMENT_CHECKOUT_URL ??
            `${(process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0]}/checkout`,
        ),
    },
  ],
})
export class PaymentsModule {}

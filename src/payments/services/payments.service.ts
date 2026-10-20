import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { isCoursePaid } from '../../enrollments/utils/access.util.js';
import { ACTIVE_ENROLLMENT } from '../../enrollments/constants/enrollment.constants.js';
import type { Payment } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UserRole } from '../../users/types/user-role.enum.js';
import type { PaymentWebhookDto } from '../dto/payment.dto.js';
import { PAYMENT_PROVIDER } from '../constants/payment.constants.js';
import type { PaymentProvider } from '../types/payment-provider.types.js';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  private view(payment: Payment) {
    return {
      id: payment.id,
      courseId: payment.courseId,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      provider: payment.provider,
      paidAt: payment.paidAt,
      // Only a pending payment can still be completed at the gateway.
      checkoutUrl:
        payment.status === 'pending'
          ? this.provider.checkoutUrl(payment.providerPaymentId)
          : null,
    };
  }

  // Starts the payment for the paid lessons of a course the learner is
  // enrolled in. Calling it again while a payment is pending returns that one.
  async init(courseId: number, user: JwtPayload) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        userId: user.sub,
        courseId,
        isDeleted: false,
        status: { in: [...ACTIVE_ENROLLMENT] },
        course: { isDeleted: false, status: 'published' },
      },
      include: { course: true, payment: { select: { status: true } } },
    });
    if (!enrollment) {
      throw new ForbiddenException('Enroll in the course first');
    }
    if (isCoursePaid(enrollment.course.price, enrollment.payment?.status)) {
      throw new ConflictException('This course is already fully unlocked');
    }

    const pending = await this.prisma.payment.findFirst({
      where: {
        userId: user.sub,
        courseId,
        status: 'pending',
        isDeleted: false,
      },
      orderBy: { id: 'desc' },
    });
    if (pending) return this.view(pending);

    const { price, currency } = enrollment.course;
    const checkout = await this.provider.createCheckout({
      amount: Number(price),
      currency,
      courseId,
      userId: user.sub,
    });
    const payment = await this.prisma.payment.create({
      data: {
        userId: user.sub,
        courseId,
        amount: price,
        currency,
        provider: this.provider.name,
        providerPaymentId: checkout.providerPaymentId,
      },
    });
    return this.view(payment);
  }

  async get(id: number, user: JwtPayload) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, isDeleted: false },
    });
    // Other people's payments look nonexistent, not forbidden.
    if (
      !payment ||
      !(payment.userId === user.sub || user.role === UserRole.ADMIN)
    ) {
      throw new NotFoundException('Payment not found');
    }
    return this.view(payment);
  }

  // Settles a payment from a gateway callback. Safe to receive twice: the
  // (provider, providerTransactionId) pair is unique, so a replay is a no-op.
  async settle(dto: PaymentWebhookDto) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        provider: this.provider.name,
        providerPaymentId: dto.providerPaymentId,
        isDeleted: false,
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (
      Number(payment.amount) !== dto.amount ||
      payment.currency !== dto.currency
    ) {
      throw new BadRequestException('Amount or currency does not match');
    }

    const success = dto.status === 'success';
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            provider: payment.provider,
            providerTransactionId: dto.providerTransactionId,
            transactionType: 'charge',
            amount: payment.amount,
            currency: payment.currency,
            status: success ? 'success' : 'failed',
          },
        });
        // Only the first outcome counts; a pending payment settles once.
        const moved = await tx.payment.updateMany({
          where: { id: payment.id, status: 'pending' },
          data: {
            status: success ? 'paid' : 'failed',
            paidAt: success ? new Date() : null,
          },
        });
        if (success && moved.count === 1) {
          await tx.enrollment.updateMany({
            where: {
              userId: payment.userId,
              courseId: payment.courseId,
              isDeleted: false,
            },
            data: { paymentId: payment.id },
          });
        }
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw error;
    }
    return { received: true, duplicate: false };
  }

  // Development shortcut standing in for the gateway's checkout page. Only
  // the mock provider offers it, never in production.
  async mockConfirm(id: number, user: JwtPayload) {
    if (
      this.provider.name !== 'mock' ||
      process.env.NODE_ENV === 'production'
    ) {
      throw new NotFoundException();
    }
    const payment = await this.prisma.payment.findFirst({
      where: { id, userId: user.sub, isDeleted: false },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.settle({
      providerPaymentId: payment.providerPaymentId,
      providerTransactionId: `mock_txn_${payment.id}`,
      status: 'success',
      amount: Number(payment.amount),
      currency: payment.currency,
    });
    return this.get(id, user);
  }
}

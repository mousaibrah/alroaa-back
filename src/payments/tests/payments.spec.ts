import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  MockPaymentProvider,
  signPayload,
} from '../providers/mock-payment.provider.js';
import { PaymentsService } from '../services/payments.service.js';

const user: JwtPayload = {
  sub: 7,
  email: 's@example.com',
  roleId: 2,
  role: 'student',
  permissions: [],
};

const provider = new MockPaymentProvider('secret', 'http://app/checkout');

describe('MockPaymentProvider.verifyWebhook', () => {
  const body = Buffer.from('{"a":1}');

  it('accepts the right signature', () => {
    expect(provider.verifyWebhook(body, signPayload('secret', body))).toBe(
      true,
    );
  });

  it('rejects wrong, tampered or missing signatures', () => {
    expect(provider.verifyWebhook(body, signPayload('other', body))).toBe(
      false,
    );
    expect(
      provider.verifyWebhook(
        Buffer.from('{"a":2}'),
        signPayload('secret', body),
      ),
    ).toBe(false);
    expect(provider.verifyWebhook(body, undefined)).toBe(false);
    expect(provider.verifyWebhook(body, 'short')).toBe(false);
  });
});

describe('PaymentsService.init', () => {
  const make = (opts: {
    enrollment?: object | null;
    pending?: object | null;
  }) => {
    const prisma = {
      enrollment: { findFirst: vi.fn().mockResolvedValue(opts.enrollment) },
      payment: {
        findFirst: vi.fn().mockResolvedValue(opts.pending ?? null),
        create: vi.fn((a: { data: object }) =>
          Promise.resolve({
            id: 1,
            status: 'pending',
            paidAt: null,
            ...a.data,
          }),
        ),
      },
    };
    return {
      prisma,
      service: new PaymentsService(
        prisma as unknown as PrismaService,
        provider,
      ),
    };
  };
  const enrolled = (price: number, payment: object | null = null) => ({
    course: { price, currency: 'USD' },
    payment,
  });

  it('requires an enrollment first', async () => {
    const { service } = make({ enrollment: null });
    await expect(service.init(1, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses when the course is already unlocked', async () => {
    for (const enrollment of [enrolled(0), enrolled(50, { status: 'paid' })]) {
      const { service } = make({ enrollment });
      await expect(service.init(1, user)).rejects.toBeInstanceOf(
        ConflictException,
      );
    }
  });

  it('creates a pending payment with a checkout url', async () => {
    const { service, prisma } = make({ enrollment: enrolled(50) });
    const result = await service.init(1, user);
    expect(result).toMatchObject({ status: 'pending', amount: 50 });
    expect(result.checkoutUrl).toMatch(/^http:\/\/app\/checkout\/mock_/);
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
  });

  it('reuses a pending payment instead of creating another', async () => {
    const pending = {
      id: 3,
      courseId: 1,
      amount: 50,
      currency: 'USD',
      status: 'pending',
      provider: 'mock',
      providerPaymentId: 'mock_x',
      paidAt: null,
    };
    const { service, prisma } = make({ enrollment: enrolled(50), pending });
    const result = await service.init(1, user);
    expect(result.id).toBe(3);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.settle', () => {
  const payment = {
    id: 3,
    userId: 7,
    courseId: 1,
    amount: 50,
    currency: 'USD',
    provider: 'mock',
  };
  const dto = {
    providerPaymentId: 'mock_x',
    providerTransactionId: 't1',
    status: 'success' as const,
    amount: 50,
    currency: 'USD',
  };
  const make = (opts: { moved?: number; duplicate?: boolean } = {}) => {
    const tx = {
      paymentTransaction: {
        create: vi.fn(() =>
          opts.duplicate
            ? Promise.reject(Object.assign(new Error('dup'), { code: 'P2002' }))
            : Promise.resolve({}),
        ),
      },
      payment: {
        updateMany: vi.fn().mockResolvedValue({ count: opts.moved ?? 1 }),
      },
      enrollment: { updateMany: vi.fn() },
    };
    const prisma = {
      payment: { findFirst: vi.fn().mockResolvedValue(payment) },
      $transaction: vi.fn((fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    };
    return {
      tx,
      service: new PaymentsService(
        prisma as unknown as PrismaService,
        provider,
      ),
    };
  };

  it('marks the payment paid and attaches it to the enrollment', async () => {
    const { service, tx } = make();
    await expect(service.settle(dto)).resolves.toMatchObject({
      duplicate: false,
    });
    expect(tx.enrollment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paymentId: 3 } }),
    );
  });

  it('does not touch the enrollment on a failed charge', async () => {
    const { service, tx } = make();
    await service.settle({ ...dto, status: 'failed' });
    expect(tx.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('does not re-link when the payment already settled', async () => {
    const { service, tx } = make({ moved: 0 });
    await service.settle({ ...dto, providerTransactionId: 't2' });
    expect(tx.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('treats a replayed transaction id as a duplicate', async () => {
    const { service } = make({ duplicate: true });
    await expect(service.settle(dto)).resolves.toEqual({
      received: true,
      duplicate: true,
    });
  });

  it('rejects a mismatching amount', async () => {
    const { service } = make();
    await expect(service.settle({ ...dto, amount: 1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

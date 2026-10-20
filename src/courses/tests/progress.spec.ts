import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ProgressService } from '../services/progress.service.js';
import { reachedThreshold, unlockedLessonIds } from '../utils/unlock.util.js';

const user: JwtPayload = {
  sub: 7,
  email: 's@example.com',
  roleId: 2,
  role: 'student',
  permissions: [],
};

describe('reachedThreshold', () => {
  it('completes at exactly 95% of the duration', () => {
    expect(reachedThreshold(95, 100)).toBe(true);
    expect(reachedThreshold(94, 100)).toBe(false);
  });

  it('never completes lessons without a measurable duration', () => {
    expect(reachedThreshold(999, null)).toBe(false);
    expect(reachedThreshold(999, 0)).toBe(false);
  });
});

describe('unlockedLessonIds', () => {
  const lessons = [1, 2, 3].map((id) => ({ id, durationSec: 100 }));

  it('unlocks only the first lesson at the start', () => {
    expect([...unlockedLessonIds(lessons, new Set())]).toEqual([1]);
  });

  it('unlocks the next lesson once the previous is completed', () => {
    expect([...unlockedLessonIds(lessons, new Set([1]))]).toEqual([1, 2]);
  });

  it('does not skip ahead when a later lesson is completed out of order', () => {
    expect([...unlockedLessonIds(lessons, new Set([2]))]).toEqual([1, 3]);
  });
});

describe('ProgressService.report', () => {
  const makeService = (
    opts: {
      durationSec?: number | null;
      existing?: { progressSec: number; completed: boolean } | null;
      completedIds?: number[];
      enrolled?: boolean;
      lessonFound?: boolean;
      isPreview?: boolean;
      price?: number;
      paymentStatus?: string | null;
    } = {},
  ) => {
    const {
      durationSec = 100,
      existing = null,
      completedIds = [],
      enrolled = true,
      lessonFound = true,
      isPreview = false,
      price = 0,
      paymentStatus = null,
    } = opts;
    const prisma = {
      lesson: {
        findFirst: vi.fn().mockResolvedValue(
          lessonFound
            ? {
                id: 2,
                durationSec,
                isPreview,
                section: { courseId: 1, course: { price } },
              }
            : null,
        ),
      },
      enrollment: {
        findFirst: vi.fn().mockResolvedValue(
          enrolled
            ? {
                id: 9,
                status: 'active',
                payment: paymentStatus ? { status: paymentStatus } : null,
              }
            : null,
        ),
        update: vi.fn(),
      },
      courseSection: {
        findMany: vi.fn().mockResolvedValue([
          {
            lessons: [
              { id: 1, durationSec: 100 },
              { id: 2, durationSec },
              { id: 3, durationSec: 100 },
            ],
          },
        ]),
      },
      lessonProgress: {
        findMany: vi
          .fn()
          .mockResolvedValue(completedIds.map((lessonId) => ({ lessonId }))),
        findUnique: vi.fn().mockResolvedValue(existing),
        upsert: vi.fn(
          (args: { create: { progressSec: number; completed: boolean } }) =>
            Promise.resolve({
              progressSec: args.create.progressSec,
              completed: args.create.completed,
            }),
        ),
      },
    };
    return {
      prisma,
      service: new ProgressService(prisma as unknown as PrismaService),
    };
  };

  it('refuses a paid lesson until the course is paid (402)', async () => {
    const { service } = makeService({ completedIds: [1], price: 50 });
    await expect(
      service.report(2, user, { progressSec: 10 }),
    ).rejects.toMatchObject({ status: 402 });
  });

  it('opens a free lesson of a paid course without payment', async () => {
    const { service } = makeService({
      completedIds: [1],
      price: 50,
      isPreview: true,
    });
    const result = await service.report(2, user, { progressSec: 10 });
    expect(result.progressSec).toBe(10);
  });

  it('opens paid lessons once the payment is paid', async () => {
    const { service } = makeService({
      completedIds: [1],
      price: 50,
      paymentStatus: 'paid',
    });
    const result = await service.report(2, user, { progressSec: 10 });
    expect(result.progressSec).toBe(10);
  });

  it('keeps a pending payment from unlocking paid lessons', async () => {
    const { service } = makeService({
      completedIds: [1],
      price: 50,
      paymentStatus: 'pending',
    });
    await expect(
      service.report(2, user, { progressSec: 10 }),
    ).rejects.toMatchObject({ status: 402 });
  });

  it('completes the lesson at 95% and unlocks the next one', async () => {
    const { service } = makeService({ completedIds: [1] });
    const result = await service.report(2, user, { progressSec: 95 });
    expect(result).toMatchObject({
      completed: true,
      newlyCompleted: true,
      unlockedLessonId: 3,
      courseCompleted: false,
    });
  });

  it('stays incomplete below 95%', async () => {
    const { service } = makeService({ completedIds: [1] });
    const result = await service.report(2, user, { progressSec: 50 });
    expect(result).toMatchObject({ completed: false, unlockedLessonId: null });
  });

  it('caps progress at the lesson length', async () => {
    const { service } = makeService({ completedIds: [1] });
    const result = await service.report(2, user, { progressSec: 5000 });
    expect(result.progressSec).toBe(100);
  });

  it('does not let a duration lesson be completed by the client flag', async () => {
    const { service } = makeService({ completedIds: [1] });
    const result = await service.report(2, user, {
      progressSec: 10,
      completed: true,
    });
    expect(result.completed).toBe(false);
  });

  it('completes a lesson without a duration only on an explicit flag', async () => {
    const { service } = makeService({ durationSec: null, completedIds: [1] });
    expect((await service.report(2, user, { progressSec: 0 })).completed).toBe(
      false,
    );
    expect(
      (await service.report(2, user, { progressSec: 0, completed: true }))
        .completed,
    ).toBe(true);
  });

  it('keeps a completed lesson completed and never moves progress back', async () => {
    const { service } = makeService({
      completedIds: [1, 2],
      existing: { progressSec: 100, completed: true },
    });
    const result = await service.report(2, user, { progressSec: 3 });
    expect(result).toMatchObject({
      completed: true,
      newlyCompleted: false,
      unlockedLessonId: 3,
    });
  });

  it('marks the enrollment completed when the last lesson finishes', async () => {
    const { prisma, service } = makeService({ completedIds: [1, 2] });
    prisma.courseSection.findMany.mockResolvedValue([
      {
        lessons: [
          { id: 1, durationSec: 100 },
          { id: 2, durationSec: 100 },
        ],
      },
    ]);
    const result = await service.report(2, user, { progressSec: 100 });
    expect(result.courseCompleted).toBe(true);
    expect(prisma.enrollment.update).toHaveBeenCalledOnce();
  });

  it('refuses a locked lesson', async () => {
    const { prisma, service } = makeService({ completedIds: [] });
    await expect(
      service.report(2, user, { progressSec: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();
  });

  it('refuses a learner who is not enrolled', async () => {
    const { service } = makeService({ enrolled: false });
    await expect(
      service.report(2, user, { progressSec: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 404 for an unknown or unpublished lesson', async () => {
    const { service } = makeService({ lessonFound: false });
    await expect(
      service.report(2, user, { progressSec: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

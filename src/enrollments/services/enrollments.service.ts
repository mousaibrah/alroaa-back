import { Injectable, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { isCoursePaid } from '../utils/access.util.js';
import { ACTIVE_ENROLLMENT } from '../constants/enrollment.constants.js';

type EnrollmentRow = {
  id: number;
  courseId: number;
  status: string;
  enrolledAt: Date;
  completedAt: Date | null;
  payment: { status: string } | null;
  course: { price: unknown; currency: string };
};

const toView = (e: EnrollmentRow) => {
  const paid = isCoursePaid(e.course.price, e.payment?.status);
  return {
    id: e.id,
    courseId: e.courseId,
    status: e.status,
    enrolledAt: e.enrolledAt,
    completedAt: e.completedAt,
    price: Number(e.course.price),
    currency: e.course.currency,
    // Free (preview) lessons are open to every enrollment; the rest need this.
    paid,
    paymentRequired: !paid,
  };
};

const include = {
  payment: { select: { status: true } },
  course: { select: { price: true, currency: true } },
} as const;

@Injectable()
export class EnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  // Enrolling is free and unlocks the course's free lessons. Paid lessons
  // need a payment on top (see PaymentsService). Calling it again is a no-op.
  async enroll(courseId: number, user: JwtPayload) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false, status: 'published' },
      select: { id: true },
    });
    if (!course) throw new NotFoundException('Course not found');

    const key = { userId_courseId: { userId: user.sub, courseId } };
    const existing = await this.prisma.enrollment.findUnique({
      where: key,
      include,
    });
    if (
      existing &&
      !existing.isDeleted &&
      (ACTIVE_ENROLLMENT as readonly string[]).includes(existing.status)
    ) {
      return toView(existing);
    }

    // A cancelled/expired enrollment is reactivated; its payment (if any)
    // stays attached so the learner doesn't pay twice.
    const saved = await this.prisma.enrollment.upsert({
      where: key,
      create: { userId: user.sub, courseId },
      update: {
        status: 'active',
        isDeleted: false,
        completedAt: null,
        enrolledAt: new Date(),
      },
      include,
    });
    return toView(saved);
  }

  async listMine(user: JwtPayload) {
    const rows = await this.prisma.enrollment.findMany({
      where: {
        userId: user.sub,
        isDeleted: false,
        status: { in: [...ACTIVE_ENROLLMENT] },
        course: { isDeleted: false },
      },
      orderBy: { enrolledAt: 'desc' },
      include: {
        ...include,
        course: {
          select: { price: true, currency: true, title: true, slug: true },
        },
      },
    });
    return rows.map((row) => ({
      ...toView(row),
      courseTitle: row.course.title,
      courseSlug: row.course.slug,
    }));
  }
}

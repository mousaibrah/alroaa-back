import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import {
  isCoursePaid,
  lessonAccess,
} from '../../enrollments/utils/access.util.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { UpdateProgressDto } from '../dto/progress.dto.js';
import { reachedThreshold, unlockedLessonIds } from '../utils/unlock.util.js';
import { ORDER } from '../../common/constants/ordering.js';

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  // Heartbeat from the player: records how far the learner got, completes the
  // lesson at the threshold and reports which lesson is now unlocked.
  async report(lessonId: number, user: JwtPayload, dto: UpdateProgressDto) {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        isDeleted: false,
        section: {
          isDeleted: false,
          course: { isDeleted: false, status: 'published' },
        },
      },
      select: {
        id: true,
        durationSec: true,
        isPreview: true,
        section: {
          select: { courseId: true, course: { select: { price: true } } },
        },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    const courseId = lesson.section.courseId;

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        userId: user.sub,
        courseId,
        isDeleted: false,
        status: { in: ['active', 'completed'] },
      },
      select: { id: true, status: true, payment: { select: { status: true } } },
    });
    if (!enrollment) throw new ForbiddenException('You are not enrolled');

    // Free lessons open on enrollment alone; the rest need a payment.
    const paid = isCoursePaid(
      lesson.section.course.price,
      enrollment.payment?.status,
    );
    if (lessonAccess(lesson.isPreview, paid) === 'payment_required') {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'PAYMENT_REQUIRED',
          message: 'Payment is required to open this lesson',
          courseId,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const ordered = await this.orderedLessons(courseId);
    const done = await this.prisma.lessonProgress.findMany({
      where: {
        userId: user.sub,
        completed: true,
        isDeleted: false,
        lessonId: { in: ordered.map((l) => l.id) },
      },
      select: { lessonId: true },
    });
    const completedIds = new Set(done.map((p) => p.lessonId));

    if (!unlockedLessonIds(ordered, completedIds).has(lessonId)) {
      throw new ForbiddenException('Complete the previous lesson first');
    }

    const existing = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.sub, lessonId } },
    });

    // Progress only moves forward and can't pass the lesson's length.
    const cap = lesson.durationSec ?? dto.progressSec;
    const progressSec = Math.max(
      existing?.progressSec ?? 0,
      Math.min(dto.progressSec, cap),
    );
    const alreadyCompleted = existing?.completed ?? false;
    const completed =
      alreadyCompleted ||
      reachedThreshold(progressSec, lesson.durationSec) ||
      (lesson.durationSec === null && dto.completed === true);
    const newlyCompleted = completed && !alreadyCompleted;
    const now = new Date();

    const saved = await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: user.sub, lessonId } },
      create: {
        userId: user.sub,
        lessonId,
        progressSec,
        completed,
        lastAccess: now,
        completedAt: completed ? now : null,
      },
      update: {
        progressSec,
        completed,
        lastAccess: now,
        ...(newlyCompleted ? { completedAt: now } : {}),
        isDeleted: false,
      },
    });

    if (completed) completedIds.add(lessonId);
    const courseCompleted = ordered.every((l) => completedIds.has(l.id));
    if (newlyCompleted && courseCompleted && enrollment.status === 'active') {
      await this.prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: 'completed', completedAt: now },
      });
    }

    const index = ordered.findIndex((l) => l.id === lessonId);
    const next = completed ? ordered[index + 1] : undefined;

    return {
      lessonId,
      progressSec: saved.progressSec,
      completed: saved.completed,
      newlyCompleted,
      // The lesson that is now open to the learner, once this one is done.
      unlockedLessonId: next?.id ?? null,
      courseCompleted,
    };
  }

  // All lessons of the course in play order.
  private async orderedLessons(courseId: number) {
    const sections = await this.prisma.courseSection.findMany({
      where: { courseId, isDeleted: false },
      orderBy: ORDER,
      select: {
        lessons: {
          where: { isDeleted: false },
          orderBy: ORDER,
          select: { id: true, durationSec: true },
        },
      },
    });
    return sections.flatMap((s) => s.lessons);
  }
}

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
import { ACTIVE_ENROLLMENT } from '../../enrollments/constants/enrollment.constants.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CourseAccessService } from './course-access.service.js';
import { PlaybackUrlService } from './playback-url.service.js';
import { unlockedLessonIds } from '../utils/unlock.util.js';
import { ORDER } from '../../common/constants/ordering.js';

// Decides who may watch a lesson and hands out the short-lived video URL. The
// rules are the same as on the course page: enrolled, paid (or a free preview)
// and not locked behind an unfinished lesson. Authors and admins always may.
@Injectable()
export class PlaybackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly urls: PlaybackUrlService,
  ) {}

  // `lang` picks the recording language; the other one is the fallback when a
  // lesson exists in a single language.
  async resolve(lessonId: number, user: JwtPayload, lang: 'en' | 'ar' = 'en') {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        isDeleted: false,
        section: { isDeleted: false, course: { isDeleted: false } },
      },
      select: {
        id: true,
        lessonType: true,
        contentUrlEn: true,
        contentUrlAr: true,
        isPreview: true,
        section: {
          select: {
            courseId: true,
            course: { select: { authorId: true, status: true, price: true } },
          },
        },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    const { courseId, course } = lesson.section;

    const manages = this.access.canManage(user, course.authorId);
    if (!manages && course.status !== 'published') {
      throw new NotFoundException('Lesson not found');
    }
    const contentUrl =
      lang === 'ar'
        ? (lesson.contentUrlAr ?? lesson.contentUrlEn)
        : (lesson.contentUrlEn ?? lesson.contentUrlAr);
    if (lesson.lessonType !== 'video' || !contentUrl) {
      throw new NotFoundException('This lesson has no video');
    }

    if (!manages)
      await this.assertLearnerMayWatch(lesson, courseId, course, user);
    return this.urls.sign(contentUrl);
  }

  private async assertLearnerMayWatch(
    lesson: { id: number; isPreview: boolean },
    courseId: number,
    course: { price: unknown },
    user: JwtPayload,
  ) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        userId: user.sub,
        courseId,
        isDeleted: false,
        status: { in: [...ACTIVE_ENROLLMENT] },
      },
      select: { payment: { select: { status: true } } },
    });
    if (!enrollment) throw new ForbiddenException('You are not enrolled');

    const paid = isCoursePaid(course.price, enrollment.payment?.status);
    if (lessonAccess(lesson.isPreview, paid) === 'payment_required') {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'PAYMENT_REQUIRED',
          message: 'Payment is required to watch this lesson',
          courseId,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

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
    const ordered = sections.flatMap((s) => s.lessons);
    const done = await this.prisma.lessonProgress.findMany({
      where: {
        userId: user.sub,
        completed: true,
        isDeleted: false,
        lessonId: { in: ordered.map((l) => l.id) },
      },
      select: { lessonId: true },
    });
    const completed = new Set(done.map((p) => p.lessonId));
    if (!unlockedLessonIds(ordered, completed).has(lesson.id)) {
      throw new ForbiddenException('Complete the previous lesson first');
    }
  }
}

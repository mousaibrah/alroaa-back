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
import { MediaService } from '../../media/services/media.service.js';
import { resolveLessonContent } from '../../media/utils/lesson-content.util.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CourseAccessService } from './course-access.service.js';
import { PlaybackUrlService } from './playback-url.service.js';
import { unlockedLessonIds } from '../utils/unlock.util.js';
import { ORDER } from '../../common/constants/ordering.js';

const MEDIA_SELECT = {
  id: true,
  status: true,
  type: true,
  key: true,
  isPrivate: true,
  variants: true,
} as const;

// Decides who may watch a lesson and hands out the short-lived video URL. The
// rules are the same as on the course page: enrolled, paid (or a free preview)
// and not locked behind an unfinished lesson. Authors and admins always may.
@Injectable()
export class PlaybackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly urls: PlaybackUrlService,
    private readonly media: MediaService,
  ) {}

  async resolve(lessonId: number, user: JwtPayload) {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        isDeleted: false,
        section: { isDeleted: false, course: { isDeleted: false } },
      },
      select: {
        id: true,
        lessonType: true,
        contentUrl: true,
        contentMedia: { select: MEDIA_SELECT },
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
    // An uploaded video wins over the stored URL.
    const content = resolveLessonContent(lesson);
    if (lesson.lessonType !== 'video' || !content) {
      throw new NotFoundException('This lesson has no video');
    }

    if (!manages)
      await this.assertLearnerMayWatch(lesson, courseId, course, user);
    if (content.source === 'url') return this.urls.sign(content.url);
    // Only reached after the access checks above. Private videos get a
    // 1-hour presigned URL; public (preview) ones a plain public URL.
    return this.media.playbackSource(content.media);
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

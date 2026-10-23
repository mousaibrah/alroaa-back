import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  MediaService,
  type TempFile,
} from '../../media/services/media.service.js';
import { contentStatus } from '../../media/utils/lesson-content.util.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CourseAccessService } from './course-access.service.js';
import { UserRole } from '../../users/types/user-role.enum.js';
import { isCoursePaid } from '../../enrollments/utils/access.util.js';
import { ACTIVE_ENROLLMENT } from '../../enrollments/constants/enrollment.constants.js';
import { unlockedLessonIds } from '../utils/unlock.util.js';
import type {
  CreateCourseDto,
  ListCoursesQueryDto,
  UpdateCourseDto,
} from '../dto/course.dto.js';
import { ORDER } from '../../common/constants/ordering.js';
import { toCourse, examResults } from '../utils/course.mapper.js';
import { slugify, isSlugConflict } from '../utils/slug.util.js';

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly media: MediaService,
  ) {}

  private present(course: Parameters<typeof toCourse>[0]) {
    return toCourse(course, (key) => this.media.publicUrl(key));
  }

  // The cover image, when sent, is stored once; thumbnailUrl points at it right
  // away and switches to the resized WebP once it is processed.
  create(user: JwtPayload, dto: CreateCourseDto, thumbnail?: TempFile) {
    return this.media.withUpload(thumbnail, 'image', user, async (stored) => {
      const base = slugify(dto.titleEn);
      for (let attempt = 0; ; attempt++) {
        const slug =
          attempt === 0
            ? base
            : `${base}-${Math.random().toString(36).slice(2, 8)}`;
        try {
          const course = await this.prisma.course.create({
            include: {
              thumbnailMedia: {
                select: { key: true, status: true, variants: true },
              },
            },
            data: {
              titleEn: dto.titleEn,
              titleAr: dto.titleAr,
              slug,
              descriptionEn: dto.descriptionEn,
              descriptionAr: dto.descriptionAr,
              price: dto.price,
              currency: dto.currency,
              thumbnailUrl: stored?.url,
              thumbnailMediaId: stored?.mediaId,
              authorId: user.sub,
            },
          });
          return this.present(course);
        } catch (error) {
          if (!isSlugConflict(error) || attempt >= 5) throw error;
        }
      }
    });
  }

  // `user` is undefined for guests, who only see the published catalogue.
  async list(user: JwtPayload | undefined, query: ListCoursesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    if ((query.all || query.mine) && !user) {
      throw new UnauthorizedException('Log in to list your courses');
    }
    if (query.all && user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can list all courses');
    }
    const where = query.all
      ? { isDeleted: false }
      : query.mine
        ? { isDeleted: false, authorId: user?.sub }
        : { isDeleted: false, status: 'published' as const };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: { select: { firstName: true, lastName: true } },
          thumbnailMedia: {
            select: { key: true, status: true, variants: true },
          },
        },
      }),
      this.prisma.course.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        ...this.present(row),
        authorName: `${row.author.firstName} ${row.author.lastName}`,
      })),
      total,
      page,
      limit,
    };
  }

  // Course with its curriculum. Drafts are only visible to the author/admin,
  // and lesson content is only exposed to those who may access it.
  async get(id: number, user: JwtPayload | undefined) {
    const course = await this.prisma.course.findFirst({
      where: { id, isDeleted: false },
      include: {
        thumbnailMedia: { select: { key: true, status: true, variants: true } },
        sections: {
          where: { isDeleted: false },
          orderBy: ORDER,
          include: {
            lessons: {
              where: { isDeleted: false },
              orderBy: ORDER,
              include: { contentMedia: { select: { status: true } } },
            },
          },
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found');

    const manages = user ? this.access.canManage(user, course.authorId) : false;
    if (course.status !== 'published' && !manages) {
      throw new NotFoundException('Course not found');
    }

    // Nothing opens without an enrollment, free lessons included.
    const enrollment =
      manages || !user
        ? null
        : await this.prisma.enrollment.findFirst({
            where: {
              userId: user.sub,
              courseId: id,
              isDeleted: false,
              status: { in: [...ACTIVE_ENROLLMENT] },
            },
            include: { payment: { select: { status: true } } },
          });
    const hasAccess = manages || enrollment !== null;
    // The enrolled learner (never a guest, author or admin).
    const learner = hasAccess && !manages ? user : undefined;
    // Free (preview) lessons need only the enrollment; the rest need payment.
    const paid =
      manages || isCoursePaid(course.price, enrollment?.payment?.status);

    // Enrolled learners (not the author/admin) get sequential unlocking: a
    // lesson opens once the one before it is completed.
    const lessons = course.sections.flatMap((s) => s.lessons);
    const progressRows = learner
      ? await this.prisma.lessonProgress.findMany({
          where: {
            userId: learner.sub,
            isDeleted: false,
            lessonId: { in: lessons.map((l) => l.id) },
          },
        })
      : [];
    const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));
    const unlocked = unlockedLessonIds(
      lessons,
      new Set(progressRows.filter((p) => p.completed).map((p) => p.lessonId)),
    );
    const isLocked = (lessonId: number) =>
      hasAccess && !manages && !unlocked.has(lessonId);

    // Exam summaries only: questions and answers are never sent here. Learners
    // see exams as locked until they are enrolled and every lesson is done.
    const examRows = await this.prisma.exam.findMany({
      where: { courseId: id, isDeleted: false },
      orderBy: { id: 'asc' },
      include: {
        _count: { select: { questions: { where: { isDeleted: false } } } },
      },
    });
    // The learner's own results per exam (none for authors/admins).
    const attemptRows =
      learner && examRows.length > 0
        ? await this.prisma.examAttempt.findMany({
            where: {
              userId: learner.sub,
              isDeleted: false,
              examId: { in: examRows.map((e) => e.id) },
            },
            orderBy: { id: 'desc' },
            select: {
              id: true,
              examId: true,
              status: true,
              score: true,
              maxScore: true,
              passed: true,
            },
          })
        : [];
    const allLessonsDone = lessons.every(
      (l) => progressByLesson.get(l.id)?.completed,
    );
    const examsLocked = !manages && (!hasAccess || !paid || !allLessonsDone);

    return {
      ...this.present(course),
      hasAccess,
      // Enrolled, but the paid lessons still need a payment.
      paymentRequired: hasAccess && !paid,
      enrollment: enrollment
        ? { id: enrollment.id, status: enrollment.status }
        : null,
      exams: examRows.map((exam) => ({
        id: exam.id,
        titleEn: exam.titleEn,
        titleAr: exam.titleAr,
        descriptionEn: exam.descriptionEn,
        descriptionAr: exam.descriptionAr,
        passingScore: Number(exam.passingScore),
        durationSec: exam.durationSec,
        questionCount: exam._count.questions,
        locked: examsLocked,
        ...examResults(attemptRows.filter((a) => a.examId === exam.id)),
      })),
      sections: course.sections.map((section) => ({
        id: section.id,
        titleEn: section.titleEn,
        titleAr: section.titleAr,
        descriptionEn: section.descriptionEn,
        descriptionAr: section.descriptionAr,
        sortOrder: section.sortOrder,
        lessons: section.lessons.map((lesson) => ({
          id: lesson.id,
          titleEn: lesson.titleEn,
          titleAr: lesson.titleAr,
          descriptionEn: lesson.descriptionEn,
          descriptionAr: lesson.descriptionAr,
          lessonType: lesson.lessonType,
          durationSec: lesson.durationSec,
          sortOrder: lesson.sortOrder,
          isPreview: lesson.isPreview,
          progressSec: progressByLesson.get(lesson.id)?.progressSec ?? 0,
          completed: progressByLesson.get(lesson.id)?.completed ?? false,
          locked: isLocked(lesson.id),
          // Open to the learner, but only after paying.
          paymentRequired: hasAccess && !paid && !lesson.isPreview,
          // The learner may watch it now (the player then asks for a signed,
          // short-lived URL at GET /lessons/:id/playback).
          playable:
            (lesson.contentUrl !== null || lesson.contentMediaId !== null) &&
            hasAccess &&
            !isLocked(lesson.id) &&
            (paid || lesson.isPreview),
          // The stored video address is private: only the people who edit the
          // course get it (the lesson form needs it). Learners never do.
          contentUrl: manages ? lesson.contentUrl : null,
          contentMediaId: manages ? lesson.contentMediaId : null,
          // processing / ready / failed, while the uploaded file is handled.
          contentStatus: manages ? contentStatus(lesson) : null,
        })),
      })),
    };
  }

  // A new cover replaces the old one, whose files are deleted.
  async update(
    id: number,
    user: JwtPayload,
    dto: UpdateCourseDto,
    thumbnail?: TempFile,
  ) {
    const current = await this.access.courseForManage(id, user);
    const course = await this.media.withUpload(
      thumbnail,
      'image',
      user,
      (stored) =>
        this.prisma.course.update({
          where: { id },
          include: {
            thumbnailMedia: {
              select: { key: true, status: true, variants: true },
            },
          },
          data: {
            titleEn: dto.titleEn,
            titleAr: dto.titleAr,
            descriptionEn: dto.descriptionEn,
            descriptionAr: dto.descriptionAr,
            price: dto.price,
            currency: dto.currency,
            status: dto.status,
            ...(stored
              ? { thumbnailUrl: stored.url, thumbnailMediaId: stored.mediaId }
              : {}),
          },
        }),
    );
    if (thumbnail && current.thumbnailMediaId) {
      await this.media
        .removeIfUnused(current.thumbnailMediaId)
        .catch(() => undefined);
    }
    return this.present(course);
  }

  async remove(id: number, user: JwtPayload): Promise<void> {
    await this.access.courseForManage(id, user);
    await this.prisma.course.update({
      where: { id },
      data: { isDeleted: true },
    });
  }
}

import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '../src/auth/types/jwt-payload.js';
import { CourseAccessService } from '../src/courses/services/course-access.service.js';
import { CoursesService } from '../src/courses/services/courses.service.js';
import { LessonsService } from '../src/courses/services/lessons.service.js';
import { PlaybackService } from '../src/courses/services/playback.service.js';
import { PlaybackUrlService } from '../src/courses/services/playback-url.service.js';
import { ProgressService } from '../src/courses/services/progress.service.js';
import { SectionsService } from '../src/courses/services/sections.service.js';
import { EnrollmentsService } from '../src/enrollments/services/enrollments.service.js';
import { MockPaymentProvider } from '../src/payments/providers/mock-payment.provider.js';
import { PaymentsService } from '../src/payments/services/payments.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Integration test against a REAL, DISPOSABLE Postgres database. Skipped
// unless SCRATCH_URL is set (see courses.e2e-spec.ts).
describe.skipIf(!process.env.SCRATCH_URL)(
  'enrollment & payment flow (scratch db)',
  () => {
    let prisma: PrismaService;
    let courses: CoursesService;
    let enrollments: EnrollmentsService;
    let payments: PaymentsService;
    let progress: ProgressService;
    let playback: PlaybackService;
    let teacher: JwtPayload, student: JwtPayload;
    let courseId: number;
    let free1: number, paid2: number;
    const run = Date.now();

    const mk = async (email: string, roleId: number, role: string) => {
      const u = await prisma.user.create({
        data: { firstName: 'T', lastName: role, email, password: 'x', roleId },
      });
      return { sub: u.id, email, roleId, role, permissions: [] } as JwtPayload;
    };

    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.SCRATCH_URL;
      prisma = new PrismaService();
      await prisma.$connect();
      const access = new CourseAccessService(prisma);
      courses = new CoursesService(prisma, access);
      const sections = new SectionsService(prisma, access);
      const lessons = new LessonsService(prisma, access);
      enrollments = new EnrollmentsService(prisma);
      payments = new PaymentsService(
        prisma,
        new MockPaymentProvider('s', 'http://app/checkout'),
      );
      progress = new ProgressService(prisma);
      playback = new PlaybackService(prisma, access, new PlaybackUrlService());

      teacher = await mk(`et-${run}@x.com`, 3, 'instructor');
      student = await mk(`es-${run}@x.com`, 2, 'student');

      const course = await courses.create(teacher, {
        title: 'Paid course',
        price: 50,
      });
      courseId = course.id;
      const s = await sections.create(courseId, teacher, { title: 'S' });
      const mkLesson = (title: string, isPreview: boolean) =>
        lessons.create(s.id, teacher, {
          title,
          lessonType: 'video',
          durationSec: 100,
          contentUrl: `https://x.com/${title}.mp4`,
          isPreview,
        });
      free1 = (await mkLesson('free1', true)).id;
      paid2 = (await mkLesson('paid2', false)).id;
      await courses.update(courseId, teacher, { status: 'published' });
    });
    afterAll(() => prisma?.$disconnect());

    const lessonsOf = async () =>
      (await courses.get(courseId, student)).sections.flatMap((s) => s.lessons);

    it('opens nothing without an enrollment, free lessons included', async () => {
      const page = await courses.get(courseId, student);
      expect(page.hasAccess).toBe(false);
      expect((await lessonsOf()).every((l) => !l.playable)).toBe(true);
      await expect(playback.resolve(free1, student)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        progress.report(free1, student, { progressSec: 5 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(payments.init(courseId, student)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('enrolling opens the free lessons only', async () => {
      const first = await enrollments.enroll(courseId, student);
      expect(first).toMatchObject({ paid: false, paymentRequired: true });
      // idempotent
      expect((await enrollments.enroll(courseId, student)).id).toBe(first.id);

      const [l1, l2] = await lessonsOf();
      expect(l1.playable).toBe(true);
      expect(l2).toMatchObject({ playable: false, paymentRequired: true });
      // learners get a playback URL for the free lesson, never the stored URL
      expect((await playback.resolve(free1, student)).url).toBe(
        'https://x.com/free1.mp4',
      );
      await expect(playback.resolve(paid2, student)).rejects.toMatchObject({
        status: 402,
      });
      await progress.report(free1, student, { progressSec: 100 });
      // free1 is done, so paid2 is next in sequence: only payment blocks it
      await expect(
        progress.report(paid2, student, { progressSec: 5 }),
      ).rejects.toMatchObject({ status: 402 });
    });

    it('pays through the gateway callback and unlocks the paid lessons', async () => {
      const p1 = await payments.init(courseId, student);
      expect(p1).toMatchObject({ status: 'pending', amount: 50 });
      // pending payment is reused, and does not unlock anything
      expect((await payments.init(courseId, student)).id).toBe(p1.id);
      expect((await lessonsOf())[1].playable).toBe(false);

      // someone else can't see or confirm it
      await expect(payments.get(p1.id, teacher)).rejects.toThrow();

      const stored = await prisma.payment.findUniqueOrThrow({
        where: { id: p1.id },
      });
      const hook = {
        providerPaymentId: stored.providerPaymentId,
        providerTransactionId: `txn-1-${run}`,
        status: 'success' as const,
        amount: 50,
        currency: 'USD',
      };
      await expect(payments.settle(hook)).resolves.toMatchObject({
        duplicate: false,
      });
      await expect(payments.settle(hook)).resolves.toMatchObject({
        duplicate: true,
      });
      expect(
        await prisma.paymentTransaction.count({ where: { paymentId: p1.id } }),
      ).toBe(1);

      expect((await payments.get(p1.id, student)).status).toBe('paid');
      expect((await playback.resolve(paid2, student)).url).toBe(
        'https://x.com/paid2.mp4',
      );
      // the stored address stays private: learners never get it, authors do
      expect((await lessonsOf()).every((l) => l.contentUrl === null)).toBe(
        true,
      );
      const authorView = await courses.get(courseId, teacher);
      expect(
        authorView.sections.flatMap((x) => x.lessons).map((l) => l.contentUrl),
      ).toEqual(['https://x.com/free1.mp4', 'https://x.com/paid2.mp4']);
      const [, l2] = await lessonsOf();
      expect(l2).toMatchObject({
        playable: true,
        paymentRequired: false,
      });
      const done = await progress.report(paid2, student, { progressSec: 100 });
      expect(done.courseCompleted).toBe(true);
      await expect(payments.init(courseId, student)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('a failed payment unlocks nothing and can be retried', async () => {
      const other = await mk(`ef-${Date.now()}@x.com`, 2, 'student');
      await enrollments.enroll(courseId, other);
      const p = await payments.init(courseId, other);
      const stored = await prisma.payment.findUniqueOrThrow({
        where: { id: p.id },
      });
      await payments.settle({
        providerPaymentId: stored.providerPaymentId,
        providerTransactionId: `txn-f-${run}`,
        status: 'failed',
        amount: 50,
        currency: 'USD',
      });
      expect((await payments.get(p.id, other)).status).toBe('failed');
      await expect(
        progress.report(paid2, other, { progressSec: 5 }),
      ).rejects.toBeDefined();
      const retry = await payments.init(courseId, other);
      expect(retry.id).not.toBe(p.id);
    });

    it('free courses unlock everything on enrollment', async () => {
      const free = await courses.create(teacher, { title: 'Free one' });
      await courses.update(free.id, teacher, { status: 'published' });
      const e = await enrollments.enroll(free.id, student);
      expect(e).toMatchObject({ paid: true, paymentRequired: false });
    });
  },
);

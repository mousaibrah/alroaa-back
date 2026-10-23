import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '../src/auth/types/jwt-payload.js';
import { CourseAccessService } from '../src/courses/services/course-access.service.js';
import { CoursesService } from '../src/courses/services/courses.service.js';
import { LessonsService } from '../src/courses/services/lessons.service.js';
import { ProgressService } from '../src/courses/services/progress.service.js';
import { SectionsService } from '../src/courses/services/sections.service.js';
import { ExamsService } from '../src/exams/services/exams.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Integration test against a REAL, DISPOSABLE Postgres database (it writes
// data). Skipped unless SCRATCH_URL is set, e.g.:
//   createdb testback_scratch && psql testback_scratch -f database/schema.sql -f database/seed.sql
//   SCRATCH_URL=postgresql://user:pass@localhost:5432/testback_scratch yarn test:e2e
let prisma: PrismaService;
let courses: CoursesService;
let sections: SectionsService;
let lessons: LessonsService;
let progress: ProgressService;
let exams: ExamsService;

const mk = async (
  email: string,
  roleId: number,
  role: string,
): Promise<JwtPayload> => {
  const u = await prisma.user.create({
    data: { firstName: 'T', lastName: role, email, password: 'x', roleId },
  });
  return { sub: u.id, email, roleId, role, permissions: [] };
};

describe.skipIf(!process.env.SCRATCH_URL)(
  'courses & exams integration (scratch db)',
  () => {
    let admin: JwtPayload,
      teacher: JwtPayload,
      other: JwtPayload,
      student: JwtPayload;
    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.SCRATCH_URL;
      prisma = new PrismaService();
      const access = new CourseAccessService(prisma);
      courses = new CoursesService(prisma, access);
      sections = new SectionsService(prisma, access);
      lessons = new LessonsService(prisma, access);
      progress = new ProgressService(prisma);
      exams = new ExamsService(prisma, access);
      await prisma.$connect();
      // Unique emails so the test can be re-run on the same scratch database.
      const run = Date.now();
      admin = await mk(`a-${run}@x.com`, 1, 'admin');
      teacher = await mk(`t-${run}@x.com`, 3, 'instructor');
      other = await mk(`o-${run}@x.com`, 3, 'instructor');
      student = await mk(`s-${run}@x.com`, 2, 'student');
    });
    afterAll(() => prisma?.$disconnect());

    it('courses, sections, lessons, reorder, ownership', async () => {
      const c1 = await courses.create(teacher, { titleEn: 'Intro TS!', titleAr: 'Intro TS!' });
      const c2 = await courses.create(teacher, { titleEn: 'Intro TS!', titleAr: 'Intro TS!' });
      expect(c1.slug).toMatch(/^intro-ts/);
      expect(c2.slug).not.toBe(c1.slug);
      const ar = await courses.create(teacher, { titleEn: 'دورة جافاسكربت', titleAr: 'دورة جافاسكربت' });
      expect(ar.slug).toMatch(/^دورة-جافاسكربت/);

      const s1 = await sections.create(c1.id, teacher, { titleEn: 'S1', titleAr: 'S1' });
      const s2 = await sections.create(c1.id, teacher, { titleEn: 'S2', titleAr: 'S2' });
      expect([s1.sortOrder, s2.sortOrder]).toEqual([0, 1]);
      await sections.reorder(c1.id, teacher, [s2.id, s1.id]);

      const l1 = await lessons.create(s1.id, teacher, {
        titleEn: 'L1', titleAr: 'L1',
        lessonType: 'video',
        durationSec: 100,
        contentUrl: 'https://x.com/1.mp4',
      });
      const l2 = await lessons.create(s1.id, teacher, {
        titleEn: 'L2', titleAr: 'L2',
        lessonType: 'video',
        durationSec: 100,
        contentUrl: 'https://x.com/2.mp4',
      });
      const l3 = await lessons.create(s2.id, teacher, {
        titleEn: 'L3', titleAr: 'L3',
        lessonType: 'text',
      });
      await lessons.reorder(s1.id, teacher, [l2.id, l1.id]);

      await expect(
        sections.create(c1.id, other, { titleEn: 'no', titleAr: 'no' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        lessons.reorder(s1.id, teacher, [l1.id]),
      ).rejects.toBeInstanceOf(BadRequestException);
      await sections.create(c1.id, admin, { titleEn: 'admin can', titleAr: 'admin can' });

      const detail = await courses.get(c1.id, teacher);
      // sections: s2, s1, admin-section ; s1 lessons: l2, l1
      expect(detail.sections.map((s) => s.titleEn)).toEqual([
        'S2',
        'S1',
        'admin can',
      ]);
      expect(detail.sections[1].lessons.map((l) => l.titleEn)).toEqual([
        'L2',
        'L1',
      ]);

      await lessons.remove(l3.id, teacher);
      expect(
        (await courses.get(c1.id, teacher)).sections[0].lessons,
      ).toHaveLength(0);

      // draft hidden from others, admin list-all works, non-admin refused
      await expect(courses.get(c1.id, student)).rejects.toThrow(
        'Course not found',
      );
      const all = await courses.list(admin, { all: true });
      expect(all.total).toBeGreaterThanOrEqual(3);
      await expect(courses.list(teacher, { all: true })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(
        (await courses.list(teacher, { mine: true })).items.every(
          (c) => c.authorId === teacher.sub,
        ),
      ).toBe(true);

      // ---- progress & locking (published, enrolled student)
      await courses.update(c1.id, teacher, { status: 'published' });
      await prisma.enrollment.create({
        data: { userId: student.sub, courseId: c1.id },
      });
      // play order: S2 (empty now), S1: L2, L1
      let view = await courses.get(c1.id, student);
      const flat = view.sections.flatMap((s) => s.lessons);
      expect(flat.map((l) => [l.titleEn, l.locked, l.playable])).toEqual([
        ['L2', false, true],
        ['L1', true, false],
      ]);
      await expect(
        progress.report(l1.id, student, { progressSec: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const mid = await progress.report(l2.id, student, { progressSec: 50 });
      expect(mid.completed).toBe(false);
      const done = await progress.report(l2.id, student, { progressSec: 95 });
      expect(done).toMatchObject({
        completed: true,
        newlyCompleted: true,
        unlockedLessonId: l1.id,
        courseCompleted: false,
      });
      view = await courses.get(c1.id, student);
      expect(
        view.sections
          .flatMap((s) => s.lessons)
          .map((l) => [l.titleEn, l.locked, l.completed]),
      ).toEqual([
        ['L2', false, true],
        ['L1', false, false],
      ]);
      const last = await progress.report(l1.id, student, { progressSec: 100 });
      expect(last.courseCompleted).toBe(true);
      const enr = await prisma.enrollment.findFirstOrThrow({
        where: { userId: student.sub, courseId: c1.id },
      });
      expect(enr.status).toBe('completed');

      // soft-deleted section hides its lessons
      await sections.remove(s1.id, teacher);
      expect(
        (await courses.get(c1.id, teacher)).sections.map((s) => s.titleEn),
      ).toEqual(['S2', 'admin can']);
    });

    it('exam builder: save, edit, reorder, remove, validate', async () => {
      const course = await courses.create(teacher, { titleEn: 'Exam course', titleAr: 'Exam course' });
      const created = await exams.create(course.id, teacher, {
        titleEn: 'Final', titleAr: 'Final',
        passingScore: 2,
      });
      expect(created.questions).toEqual([]);

      const saved = await exams.save(created.id, teacher, {
        titleEn: 'Final v2', titleAr: 'Final v2',
        passingScore: 2,
        durationSec: 600,
        questions: [
          {
            textEn: 'Q1', textAr: 'Q1',
            questionType: 'single_choice',
            points: 2,
            options: [
              { optionTextEn: 'a', optionTextAr: 'a', isCorrect: true },
              { optionTextEn: 'b', optionTextAr: 'b', isCorrect: false },
            ],
          },
          {
            textEn: 'Q2', textAr: 'Q2',
            questionType: 'true_false',
            points: 1,
            options: [
              { optionTextEn: 'True', optionTextAr: 'True', isCorrect: false },
              { optionTextEn: 'False', optionTextAr: 'False', isCorrect: true },
            ],
          },
          {
            textEn: 'Q3', textAr: 'Q3',
            questionType: 'multiple_choice',
            points: 1,
            options: [
              { optionTextEn: 'x', optionTextAr: 'x', isCorrect: true },
              { optionTextEn: 'y', optionTextAr: 'y', isCorrect: true },
              { optionTextEn: 'z', optionTextAr: 'z', isCorrect: false },
            ],
          },
        ],
      });
      expect(saved.questions.map((q) => q.textEn)).toEqual(['Q1', 'Q2', 'Q3']);
      expect(saved.durationSec).toBe(600);

      // reorder (Q3 first), edit Q1 text, drop Q2, drop option 'z', add option 'w'
      const [q1, , q3] = saved.questions;
      const edited = await exams.save(created.id, teacher, {
        titleEn: 'Final v2', titleAr: 'Final v2',
        passingScore: 1,
        questions: [
          {
            id: q3.id,
            textEn: 'Q3', textAr: 'Q3',
            questionType: 'multiple_choice',
            points: 1,
            options: [
              { id: q3.options[0].id, optionTextEn: 'x', optionTextAr: 'x', isCorrect: true },
              { id: q3.options[1].id, optionTextEn: 'y', optionTextAr: 'y', isCorrect: false },
              { optionTextEn: 'w', optionTextAr: 'w', isCorrect: false },
            ],
          },
          {
            id: q1.id,
            textEn: 'Q1 edited', textAr: 'Q1 edited',
            questionType: 'single_choice',
            points: 2,
            options: [
              { id: q1.options[0].id, optionTextEn: 'a', optionTextAr: 'a', isCorrect: true },
              { id: q1.options[1].id, optionTextEn: 'b', optionTextAr: 'b', isCorrect: false },
            ],
          },
        ],
      });
      expect(edited.questions.map((q) => q.textEn)).toEqual(['Q3', 'Q1 edited']);
      expect(edited.questions[0].options.map((o) => o.optionTextEn)).toEqual([
        'x',
        'y',
        'w',
      ]);
      expect(edited.durationSec).toBeNull();
      expect(
        (await exams.listForCourse(course.id, teacher))[0].questionCount,
      ).toBe(2);

      // ids from another exam are rejected
      await expect(
        exams.save(created.id, teacher, {
          titleEn: 't', titleAr: 't',
          questions: [
            {
              id: 999999,
              textEn: 'q', textAr: 'q',
              questionType: 'single_choice',
              points: 1,
              options: [
                { optionTextEn: 'a', optionTextAr: 'a', isCorrect: true },
                { optionTextEn: 'b', optionTextAr: 'b', isCorrect: false },
              ],
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        exams.save(created.id, other, { titleEn: 't', titleAr: 't', questions: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await exams.remove(created.id, admin);
      expect(await exams.listForCourse(course.id, admin)).toHaveLength(0);
    });

    it('course page lists exams, locked until enrolled and all lessons are done', async () => {
      const course = await courses.create(teacher, {
        titleEn: 'Exam lock course', titleAr: 'Exam lock course',
      });
      const sec = await sections.create(course.id, teacher, { titleEn: 'S', titleAr: 'S' });
      const lesson = await lessons.create(sec.id, teacher, {
        titleEn: 'L', titleAr: 'L',
        lessonType: 'video',
        durationSec: 100,
        contentUrl: 'https://x.com/v.mp4',
      });
      const exam = await exams.create(course.id, teacher, { titleEn: 'Quiz', titleAr: 'Quiz' });
      await exams.save(exam.id, teacher, {
        titleEn: 'Quiz', titleAr: 'Quiz',
        passingScore: 0,
        questions: [
          {
            textEn: 'secret question', textAr: 'secret question',
            questionType: 'single_choice',
            points: 1,
            options: [
              { optionTextEn: 'right', optionTextAr: 'right', isCorrect: true },
              { optionTextEn: 'wrong', optionTextAr: 'wrong', isCorrect: false },
            ],
          },
        ],
      });
      await courses.update(course.id, teacher, { status: 'published' });

      // Not enrolled: visible but locked, and never any questions or answers.
      const visitor = await courses.get(course.id, student);
      expect(visitor.exams).toMatchObject([
        { titleEn: 'Quiz', titleAr: 'Quiz', questionCount: 1, locked: true },
      ]);
      expect(JSON.stringify(visitor.exams)).not.toMatch(
        /secret question|right|isCorrect/,
      );

      // Enrolled but lessons not finished: still locked.
      await prisma.enrollment.create({
        data: { userId: student.sub, courseId: course.id },
      });
      expect((await courses.get(course.id, student)).exams[0].locked).toBe(
        true,
      );

      // Author sees it unlocked; learner unlocks it by finishing the lesson.
      expect((await courses.get(course.id, teacher)).exams[0].locked).toBe(
        false,
      );
      await progress.report(lesson.id, student, { progressSec: 95 });
      expect((await courses.get(course.id, student)).exams[0].locked).toBe(
        false,
      );

      // A deleted exam disappears from the page.
      await exams.remove(exam.id, teacher);
      expect((await courses.get(course.id, student)).exams).toHaveLength(0);
    });
  },
);

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '../src/auth/types/jwt-payload.js';
import { CourseAccessService } from '../src/courses/services/course-access.service.js';
import { CoursesService } from '../src/courses/services/courses.service.js';
import { LessonsService } from '../src/courses/services/lessons.service.js';
import { ProgressService } from '../src/courses/services/progress.service.js';
import { SectionsService } from '../src/courses/services/sections.service.js';
import { CertificatesService } from '../src/certificates/certificates.service.js';
import { AttemptsService } from '../src/exams/services/attempts.service.js';
import { ExamsService } from '../src/exams/services/exams.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Integration test against a REAL, DISPOSABLE Postgres database (needs
// database/migrations/001_exam_attempts.sql). Skipped unless SCRATCH_URL is set.
describe.skipIf(!process.env.SCRATCH_URL)('exam attempts (scratch db)', () => {
	let prisma: PrismaService;
	let courses: CoursesService;
	let attempts: AttemptsService;
	let progress: ProgressService;
	let teacher: JwtPayload, student: JwtPayload, stranger: JwtPayload;
	let courseId: number, lessonId: number, examId: number;
	let q1: { id: number; options: { id: number; text: string }[] };

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
		const exams = new ExamsService(prisma, access);
		attempts = new AttemptsService(prisma, new CertificatesService(prisma));
		progress = new ProgressService(prisma);

		const run = Date.now();
		teacher = await mk(`xt-${run}@x.com`, 3, 'instructor');
		student = await mk(`xs-${run}@x.com`, 2, 'student');
		stranger = await mk(`xo-${run}@x.com`, 2, 'student');

		courseId = (await courses.create(teacher, { title: 'Exam course' })).id;
		const s = await sections.create(courseId, teacher, { title: 'S' });
		lessonId = (
			await lessons.create(s.id, teacher, {
				title: 'L',
				lessonType: 'text',
			})
		).id;
		const exam = await exams.create(courseId, teacher, {
			title: 'Final',
			passingScore: 3,
			durationSec: 600,
		});
		examId = exam.id;
		await exams.save(examId, teacher, {
			title: 'Final',
			passingScore: 3,
			durationSec: 600,
			questions: [
				{
					text: 'Pick B',
					questionType: 'single_choice',
					points: 2,
					options: [
						{ optionText: 'A', isCorrect: false },
						{ optionText: 'B', isCorrect: true },
					],
				},
				{
					text: 'Pick even',
					questionType: 'multiple_choice',
					points: 2,
					options: [
						{ optionText: '1', isCorrect: false },
						{ optionText: '2', isCorrect: true },
						{ optionText: '4', isCorrect: true },
					],
				},
			],
		});
		await courses.update(courseId, teacher, { status: 'published' });
		await prisma.enrollment.create({
			data: { userId: student.sub, courseId },
		});
	});
	afterAll(() => prisma?.$disconnect());

	it('is closed until every lesson is completed', async () => {
		await expect(attempts.start(examId, student)).rejects.toBeInstanceOf(ForbiddenException);
		await progress.report(lessonId, student, {
			progressSec: 0,
			completed: true,
		});
	});

	it('never sends correct answers while the exam is open', async () => {
		const attempt = await attempts.start(examId, student);
		expect(JSON.stringify(attempt)).not.toMatch(/isCorrect|correct/i);
		expect(attempt.questions).toHaveLength(2);
		expect(attempt.expiresAt).not.toBeNull();
		// resuming returns the same attempt
		expect((await attempts.start(examId, student)).id).toBe(attempt.id);
		expect(JSON.stringify(await attempts.get(attempt.id, student))).not.toMatch(/isCorrect/);
		q1 = attempt.questions[0];
		// someone else can't see or submit it
		await expect(attempts.get(attempt.id, stranger)).rejects.toBeInstanceOf(NotFoundException);
		await expect(attempts.submit(attempt.id, stranger, { answers: [] })).rejects.toBeInstanceOf(NotFoundException);
	});

	it('grades on the server, then shows the score and correct answers', async () => {
		const open = await attempts.start(examId, student);
		const [a, b] = open.questions;
		const result = await attempts.submit(open.id, student, {
			answers: [
				// wrong single choice (A), fully correct multiple choice
				{ questionId: a.id, optionIds: [a.options[0].id] },
				{ questionId: b.id, optionIds: [b.options[1].id, b.options[2].id] },
			],
		});
		expect(result).toMatchObject({
			status: 'submitted',
			score: 2,
			maxScore: 4,
			passed: false,
			passingScore: 3,
		});
		expect(result.questions[0]).toMatchObject({ correct: false });
		expect(result.questions[0].options.map((o) => [o.text, o.isCorrect, o.selected])).toEqual([
			['A', false, true],
			['B', true, false],
		]);

		// submitting again returns the stored result, nothing changes
		const again = await attempts.submit(open.id, student, {
			answers: [
				{ questionId: a.id, optionIds: [a.options[1].id] },
				{ questionId: b.id, optionIds: [b.options[1].id, b.options[2].id] },
			],
		});
		expect(again.score).toBe(2);
		// the attempt is now a review
		expect(await attempts.get(open.id, student)).toMatchObject({
			status: 'submitted',
			score: 2,
		});
	});

	it('rejects answers that do not belong to the exam', async () => {
		const open = await attempts.start(examId, student);
		await expect(
			attempts.submit(open.id, student, {
				answers: [{ questionId: open.questions[0].id, optionIds: [999999] }],
			}),
		).rejects.toThrow(/does not belong/);
		// still open after a rejected submit
		expect((await attempts.get(open.id, student)).status).toBe('in_progress');

		const pass = await attempts.submit(open.id, student, {
			answers: [
				{
					questionId: open.questions[0].id,
					optionIds: [open.questions[0].options[1].id],
				},
				{
					questionId: open.questions[1].id,
					optionIds: [open.questions[1].options[1].id, open.questions[1].options[2].id],
				},
			],
		});
		expect(pass).toMatchObject({ score: 4, passed: true });
	});

	it('expires an attempt that runs past the deadline', async () => {
		const open = await attempts.start(examId, student);
		await prisma.examAttempt.update({
			where: { id: open.id },
			data: { expiresAt: new Date(Date.now() - 60_000) },
		});
		const result = await attempts.submit(open.id, student, {
			answers: [
				{
					questionId: open.questions[0].id,
					optionIds: [open.questions[0].options[1].id],
				},
			],
		});
		expect(result).toMatchObject({
			status: 'expired',
			score: 0,
			passed: false,
		});
		// an expired attempt doesn't block a new one
		const next = await attempts.start(examId, student);
		expect(next.id).not.toBe(open.id);
		await prisma.examAttempt.update({
			where: { id: next.id },
			data: { expiresAt: new Date(Date.now() - 60_000) },
		});
		// an unfinished attempt is expired when looked at after the deadline
		expect(await attempts.get(next.id, student)).toMatchObject({
			status: 'expired',
		});
	});

	it('summarises results on the course page', async () => {
		const page = await courses.get(courseId, student);
		expect(page.exams[0]).toMatchObject({
			locked: false,
			passed: true,
			bestScore: 4,
			attempts: 4,
			inProgress: false,
		});
		expect(q1.id).toBeGreaterThan(0);
		const history = await attempts.listMine(examId, student);
		expect(history).toHaveLength(4);
	});
});

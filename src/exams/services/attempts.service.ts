import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CertificatesService } from '../../certificates/certificates.service.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { isCoursePaid } from '../../enrollments/utils/access.util.js';
import { ACTIVE_ENROLLMENT } from '../../enrollments/constants/enrollment.constants.js';
import type { ExamAttempt, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SubmitAttemptDto } from '../dto/attempt.dto.js';
import { gradeExam, hasPassed, normalizeAnswers } from '../utils/grading.js';
import type { Graded, GradableQuestion } from '../types/grading.types.js';
import { ORDER } from '../../common/constants/ordering.js';
import { GRACE_MS } from '../constants/attempt.constants.js';
import type { StoredResult } from '../types/attempt-result.types.js';

@Injectable()
export class AttemptsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly certificates: CertificatesService,
	) {}

	// Starts the exam, or resumes the unfinished attempt (the timer keeps running).
	async start(examId: number, user: JwtPayload) {
		const exam = await this.prisma.exam.findFirst({
			where: {
				id: examId,
				isDeleted: false,
				course: { isDeleted: false, status: 'published' },
			},
			include: { course: { select: { id: true, price: true } } },
		});
		if (!exam) throw new NotFoundException('Exam not found');
		await this.assertEligible(exam.course, user);

		const active = await this.findActive(examId, user.sub);
		if (active) {
			if (!this.isOverdue(active)) return this.takingView(active);
			await this.finalize(active, 'expired', new Map());
		}

		const questionCount = await this.prisma.question.count({
			where: { examId, isDeleted: false },
		});
		if (questionCount === 0) {
			throw new ConflictException('This exam has no questions yet');
		}

		const now = new Date();
		try {
			const attempt = await this.prisma.examAttempt.create({
				data: {
					examId,
					userId: user.sub,
					startedAt: now,
					expiresAt: exam.durationSec ? new Date(now.getTime() + exam.durationSec * 1000) : null,
				},
			});
			return this.takingView(attempt);
		} catch (error) {
			// Two simultaneous starts: the unique index lets only one win.
			if ((error as { code?: string }).code !== 'P2002') throw error;
			const winner = await this.findActive(examId, user.sub);
			if (!winner) throw error;
			return this.takingView(winner);
		}
	}

	// An unfinished attempt (questions without answers) or the graded result.
	async get(attemptId: number, user: JwtPayload) {
		let attempt = await this.owned(attemptId, user);
		if (attempt.status === 'in_progress' && this.isOverdue(attempt)) {
			attempt = await this.finalize(attempt, 'expired', new Map());
		}
		return attempt.status === 'in_progress' ? this.takingView(attempt) : this.resultView(attempt);
	}

	async submit(attemptId: number, user: JwtPayload, dto: SubmitAttemptDto) {
		const attempt = await this.owned(attemptId, user);
		// Submitting twice (double click, retry) returns the stored result.
		if (attempt.status !== 'in_progress') return this.resultView(attempt);

		if (this.isOverdue(attempt)) {
			return this.resultView(await this.finalize(attempt, 'expired', new Map()));
		}
		const questions = await this.loadQuestions(attempt.examId);
		const selected = normalizeAnswers(questions, dto.answers);
		return this.resultView(await this.finalize(attempt, 'submitted', selected, dto));
	}

	async listMine(examId: number, user: JwtPayload) {
		const rows = await this.prisma.examAttempt.findMany({
			where: { examId, userId: user.sub, isDeleted: false },
			orderBy: { id: 'desc' },
		});
		return rows.map((a) => ({
			id: a.id,
			status: a.status,
			startedAt: a.startedAt,
			submittedAt: a.submittedAt,
			score: a.score === null ? null : Number(a.score),
			maxScore: a.maxScore === null ? null : Number(a.maxScore),
			passed: a.passed,
		}));
	}

	// ---- rules

	// Same gate the course page shows: enrolled, paid, every lesson completed.
	private async assertEligible(course: { id: number; price: unknown }, user: JwtPayload) {
		const enrollment = await this.prisma.enrollment.findFirst({
			where: {
				userId: user.sub,
				courseId: course.id,
				isDeleted: false,
				status: { in: [...ACTIVE_ENROLLMENT] },
			},
			include: { payment: { select: { status: true } } },
		});
		if (!enrollment) throw new ForbiddenException('You are not enrolled');
		if (!isCoursePaid(course.price, enrollment.payment?.status)) {
			throw new ForbiddenException('Payment is required to take this exam');
		}
		const lessonIds = (
			await this.prisma.lesson.findMany({
				where: {
					isDeleted: false,
					section: { courseId: course.id, isDeleted: false },
				},
				select: { id: true },
			})
		).map((l) => l.id);
		const done = await this.prisma.lessonProgress.count({
			where: {
				userId: user.sub,
				completed: true,
				isDeleted: false,
				lessonId: { in: lessonIds },
			},
		});
		if (done < lessonIds.length) {
			throw new ForbiddenException('Complete all lessons first');
		}
	}

	private isOverdue(attempt: ExamAttempt, now = Date.now()): boolean {
		return attempt.expiresAt !== null && now > attempt.expiresAt.getTime() + GRACE_MS;
	}

	// Grades and stores the attempt, once: only a still-in-progress attempt can
	// be claimed, so concurrent submits can't both write a result.
	private async finalize(
		attempt: ExamAttempt,
		status: 'submitted' | 'expired',
		selected: Map<number, Set<number>>,
		dto?: SubmitAttemptDto,
	): Promise<ExamAttempt> {
		const exam = await this.prisma.exam.findUniqueOrThrow({
			where: { id: attempt.examId },
			select: {
				titleEn: true,
				titleAr: true,
				courseId: true,
				passingScore: true,
			},
		});
		const questions = await this.loadQuestions(attempt.examId);
		const graded: Graded = gradeExam(questions, selected);
		const passingScore = Number(exam.passingScore);
		const result: StoredResult = {
			examTitleEn: exam.titleEn,
			examTitleAr: exam.titleAr,
			courseId: exam.courseId,
			passingScore,
			questions: graded.questions,
		};
		await this.prisma.examAttempt.updateMany({
			where: { id: attempt.id, status: 'in_progress' },
			data: {
				status,
				submittedAt: new Date(),
				score: graded.score,
				maxScore: graded.maxScore,
				passed: hasPassed(graded.score, passingScore),
				answers: (dto?.answers ?? []) as unknown as Prisma.InputJsonValue,
				result: result as unknown as Prisma.InputJsonValue,
			},
		});
		return this.prisma.examAttempt.findUniqueOrThrow({
			where: { id: attempt.id },
		});
	}

	// ---- data

	private findActive(examId: number, userId: number) {
		return this.prisma.examAttempt.findFirst({
			where: { examId, userId, status: 'in_progress', isDeleted: false },
		});
	}

	private async owned(attemptId: number, user: JwtPayload) {
		const attempt = await this.prisma.examAttempt.findFirst({
			where: { id: attemptId, userId: user.sub, isDeleted: false },
		});
		// Other people's attempts look nonexistent.
		if (!attempt) throw new NotFoundException('Attempt not found');
		return attempt;
	}

	private async loadQuestions(examId: number): Promise<GradableQuestion[]> {
		const rows = await this.prisma.question.findMany({
			where: { examId, isDeleted: false },
			orderBy: ORDER,
			include: { options: { where: { isDeleted: false }, orderBy: ORDER } },
		});
		return rows.map((q) => ({
			id: q.id,
			textEn: q.textEn,
			textAr: q.textAr,
			questionType: q.questionType,
			points: Number(q.points),
			options: q.options,
		}));
	}

	// ---- views

	// What the learner sees while taking the exam: no `isCorrect` anywhere.
	private async takingView(attempt: ExamAttempt) {
		const exam = await this.prisma.exam.findUniqueOrThrow({
			where: { id: attempt.examId },
			select: {
				id: true,
				titleEn: true,
				titleAr: true,
				courseId: true,
				passingScore: true,
			},
		});
		const questions = await this.loadQuestions(attempt.examId);
		return {
			id: attempt.id,
			status: attempt.status,
			examId: exam.id,
			courseId: exam.courseId,
			examTitleEn: exam.titleEn,
			examTitleAr: exam.titleAr,
			passingScore: Number(exam.passingScore),
			startedAt: attempt.startedAt,
			expiresAt: attempt.expiresAt,
			// Lets the browser correct for a wrong local clock when counting down.
			serverNow: new Date(),
			questions: questions.map((q) => ({
				id: q.id,
				textEn: q.textEn,
				textAr: q.textAr,
				questionType: q.questionType,
				points: q.points,
				options: q.options.map((o) => ({
					id: o.id,
					textEn: o.optionTextEn,
					textAr: o.optionTextAr,
				})),
			})),
		};
	}

	// Passing the last exam of a course issues the certificate; looking at a
	// passed result again also catches one that could not be issued before.
	private async resultView(attempt: ExamAttempt) {
		const result = attempt.result as unknown as StoredResult;
		const certificate = attempt.passed === true ? await this.certificates.issueIfEarned(attempt.userId, result.courseId, attempt.id) : null;
		return {
			id: attempt.id,
			status: attempt.status,
			examId: attempt.examId,
			courseId: result.courseId,
			examTitleEn: result.examTitleEn,
			examTitleAr: result.examTitleAr,
			passingScore: result.passingScore,
			startedAt: attempt.startedAt,
			submittedAt: attempt.submittedAt,
			score: Number(attempt.score),
			maxScore: Number(attempt.maxScore),
			passed: attempt.passed === true,
			questions: result.questions,
			// Set once the course is finished (every exam passed), else null.
			certificateCode: certificate?.code ?? null,
		};
	}
}

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.js';
import type { Certificate } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { generateCertificateCode, normalizeCertificateCode } from './utils/code.util.js';

const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class CertificatesService {
	constructor(private readonly prisma: PrismaService) {}

	// Issues the certificate once the learner has passed every exam of the
	// course. Safe to call again: it returns the existing one, or null while the
	// course is not finished yet.
	async issueIfEarned(userId: number, courseId: number, attemptId?: number): Promise<Certificate | null> {
		const existing = await this.find(userId, courseId);
		if (existing) return existing;

		const exams = await this.prisma.exam.findMany({
			where: { courseId, isDeleted: false },
			select: { id: true },
		});
		if (exams.length === 0) return null;
		const passed = await this.prisma.examAttempt.findMany({
			where: {
				userId,
				passed: true,
				status: 'submitted',
				isDeleted: false,
				examId: { in: exams.map((e) => e.id) },
			},
			distinct: ['examId'],
			orderBy: { id: 'desc' },
			select: { id: true },
		});
		if (passed.length < exams.length) return null;

		const [user, course, lessons] = await Promise.all([
			this.prisma.user.findUniqueOrThrow({
				where: { id: userId },
				select: {
					firstName: true,
					lastName: true,
					firstNameAr: true,
					lastNameAr: true,
				},
			}),
			this.prisma.course.findUniqueOrThrow({
				where: { id: courseId },
				select: { titleEn: true, titleAr: true },
			}),
			this.prisma.lesson.aggregate({
				where: {
					isDeleted: false,
					section: { courseId, isDeleted: false },
				},
				_sum: { durationSec: true },
			}),
		]);

		const holderNameAr = `${user.firstNameAr ?? ''} ${user.lastNameAr ?? ''}`.trim();

		for (let attempt = 0; ; attempt++) {
			try {
				return await this.prisma.certificate.create({
					data: {
						code: generateCertificateCode(),
						userId,
						courseId,
						// The attempt that finished the course (the latest pass).
						attemptId: attemptId ?? passed[0].id,
						holderName: `${user.firstName} ${user.lastName}`.trim(),
						holderNameAr: holderNameAr || null,
						courseTitleEn: course.titleEn,
						courseTitleAr: course.titleAr,
						learningSeconds: lessons._sum.durationSec ?? 0,
					},
				});
			} catch (error) {
				if ((error as { code?: string }).code !== 'P2002') throw error;
				// Two simultaneous issues: the other one won.
				const winner = await this.find(userId, courseId);
				if (winner) return winner;
				// Otherwise the random code collided: try another.
				if (attempt >= MAX_CODE_ATTEMPTS) throw error;
			}
		}
	}

	// Explicit request from the learner (the course page's "get my certificate"):
	// issues it when the course is finished, otherwise says why not. Idempotent.
	async issueForCourse(user: JwtPayload, courseId: number) {
		const course = await this.prisma.course.findFirst({
			where: { id: courseId, isDeleted: false },
			select: { id: true },
		});
		if (!course) throw new NotFoundException('Course not found');
		const certificate = await this.issueIfEarned(user.sub, courseId);
		if (!certificate) {
			throw new ForbiddenException('Pass every exam of the course to get the certificate');
		}
		return this.view(certificate);
	}

	find(userId: number, courseId: number) {
		return this.prisma.certificate.findFirst({
			where: { userId, courseId, isDeleted: false },
		});
	}

	async listMine(user: JwtPayload) {
		const rows = await this.prisma.certificate.findMany({
			where: { userId: user.sub, isDeleted: false },
			orderBy: { issuedAt: 'desc' },
		});
		return rows.map((row) => this.view(row));
	}

	// Public: anyone holding a code can check it. Only what is printed on the
	// certificate is returned.
	async verify(code: string) {
		const row = await this.prisma.certificate.findFirst({
			where: { code: normalizeCertificateCode(code), isDeleted: false },
		});
		if (!row) throw new NotFoundException('Certificate not found');
		return this.view(row);
	}

	view(row: Certificate) {
		return {
			code: row.code,
			holderName: row.holderName,
			holderNameAr: row.holderNameAr,
			courseId: row.courseId,
			courseTitleEn: row.courseTitleEn,
			courseTitleAr: row.courseTitleAr,
			learningSeconds: row.learningSeconds,
			issuedAt: row.issuedAt,
		};
	}
}

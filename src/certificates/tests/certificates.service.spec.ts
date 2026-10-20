import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CertificatesService } from '../certificates.service.js';

const user = { sub: 7 } as JwtPayload;

const row = {
	code: 'RNEC-7K2M9-XQ4PD',
	holderName: 'Ada Lovelace',
	courseId: 1,
	courseTitle: 'Intro',
	learningSeconds: 60,
	issuedAt: new Date('2026-01-01'),
};

function setup(over: Record<string, unknown> = {}) {
	const prisma = {
		course: { findFirst: vi.fn().mockResolvedValue({ id: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ title: 'Intro' }) },
		certificate: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(row) },
		exam: { findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]) },
		examAttempt: { findMany: vi.fn().mockResolvedValue([{ id: 9 }, { id: 4 }]) },
		user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace' }) },
		lesson: { aggregate: vi.fn().mockResolvedValue({ _sum: { durationSec: 60 } }) },
		...over,
	};
	return { prisma, service: new CertificatesService(prisma as unknown as PrismaService) };
}

describe('CertificatesService', () => {
	it('issues when every exam is passed, linked to the latest passing attempt', async () => {
		const { prisma, service } = setup();
		const view = await service.issueForCourse(user, 1);
		expect(view.code).toBe(row.code);
		expect(prisma.certificate.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ userId: 7, courseId: 1, attemptId: 9 }) }),
		);
	});

	it('is idempotent: returns the existing certificate', async () => {
		const { prisma, service } = setup({
			certificate: { findFirst: vi.fn().mockResolvedValue(row), create: vi.fn() },
		});
		await service.issueForCourse(user, 1);
		expect(prisma.certificate.create).not.toHaveBeenCalled();
	});

	it('refuses while an exam is not passed', async () => {
		const { service } = setup({ examAttempt: { findMany: vi.fn().mockResolvedValue([{ id: 4 }]) } });
		await expect(service.issueForCourse(user, 1)).rejects.toBeInstanceOf(ForbiddenException);
	});

	it('refuses a course without exams', async () => {
		const { service } = setup({ exam: { findMany: vi.fn().mockResolvedValue([]) } });
		await expect(service.issueForCourse(user, 1)).rejects.toBeInstanceOf(ForbiddenException);
	});

	it('404s for an unknown course', async () => {
		const { service } = setup({ course: { findFirst: vi.fn().mockResolvedValue(null) } });
		await expect(service.issueForCourse(user, 99)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('verifies any spelling of a code and 404s on unknown ones', async () => {
		const { prisma, service } = setup({
			certificate: { findFirst: vi.fn().mockResolvedValueOnce(row).mockResolvedValueOnce(null) },
		});
		expect((await service.verify('rnec7k2m9xq4pd')).holderName).toBe('Ada Lovelace');
		expect(prisma.certificate.findFirst).toHaveBeenCalledWith({ where: { code: 'RNEC-7K2M9-XQ4PD', isDeleted: false } });
		await expect(service.verify('nope')).rejects.toBeInstanceOf(NotFoundException);
	});
});

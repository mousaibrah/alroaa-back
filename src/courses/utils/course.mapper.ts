import type { Course } from '../../generated/prisma/client.js';

// Prisma returns Decimal for price; the API exposes a plain number.
export const toCourse = (course: Course) => ({
  id: course.id,
  titleEn: course.titleEn,
  titleAr: course.titleAr,
  slug: course.slug,
  descriptionEn: course.descriptionEn,
  descriptionAr: course.descriptionAr,
  price: Number(course.price),
  currency: course.currency,
  status: course.status,
  authorId: course.authorId,
  thumbnailUrl: course.thumbnailUrl,
  createdAt: course.createdAt,
  updatedAt: course.updatedAt,
});

// Summary of a learner's attempts at one exam (newest first).
export const examResults = (
  attempts: {
    id: number;
    status: string;
    score: unknown;
    maxScore: unknown;
    passed: boolean | null;
  }[],
) => {
  const finished = attempts.filter((a) => a.status !== 'in_progress');
  const scores = finished.map((a) => Number(a.score));
  return {
    attempts: finished.length,
    lastAttemptId: finished.length > 0 ? finished[0].id : null,
    inProgress: attempts.some((a) => a.status === 'in_progress'),
    passed: finished.some((a) => a.passed === true),
    bestScore: scores.length > 0 ? Math.max(...scores) : null,
    maxScore: finished.length > 0 ? Number(finished[0].maxScore) : null,
  };
};

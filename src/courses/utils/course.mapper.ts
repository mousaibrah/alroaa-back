import type { Course } from '../../generated/prisma/client.js';

// Prisma returns Decimal for price; the API exposes a plain number.
type CourseRow = Course & {
  thumbnailMedia?: {
    key: string;
    status: string;
    variants: unknown;
  } | null;
};

// The cover: an uploaded image (its 1280px WebP) wins over the legacy URL.
// `publicUrl` turns a storage key into a URL (MediaService.publicUrl).
export const toCourse = (
  course: CourseRow,
  publicUrl: (key: string) => string = () => '',
) => ({
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
  thumbnailUrl:
    course.thumbnailMedia?.status === 'ready'
      ? publicUrl(
          (
            course.thumbnailMedia.variants as {
              medium?: { key: string };
            } | null
          )?.medium?.key ?? course.thumbnailMedia.key,
        )
      : course.thumbnailUrl,
  thumbnailMediaId: course.thumbnailMediaId,
  // Public intro video for the overview page (the web MP4 once processed).
  introVideoUrl: course.introVideoUrl,
  introVideoMediaId: course.introVideoMediaId,
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

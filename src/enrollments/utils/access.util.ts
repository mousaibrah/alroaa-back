import type { LessonAccess } from '../types/lesson-access.types.js';
// Course access rules, shared by the course page, progress and payments.
//
// - No enrollment: no lesson opens, not even the free (preview) ones.
// - Enrolled, not paid: only free (preview) lessons open.
// - Enrolled and paid (or the course is free): every lesson opens, subject to
//   the sequential unlock rule.

export const isCoursePaid = (
  price: unknown,
  paymentStatus: string | null | undefined,
): boolean => Number(price) === 0 || paymentStatus === 'paid';

export const lessonAccess = (
  isPreview: boolean,
  paid: boolean,
): LessonAccess => (isPreview || paid ? 'ok' : 'payment_required');

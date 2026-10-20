import type { ReviewQuestion } from './grading.types.js';

// The graded snapshot saved with the attempt.
export interface StoredResult {
  examTitleEn: string;
  examTitleAr: string;
  courseId: number;
  passingScore: number;
  questions: ReviewQuestion[];
}

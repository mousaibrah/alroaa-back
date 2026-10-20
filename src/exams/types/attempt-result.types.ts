import type { ReviewQuestion } from './grading.types.js';

// The graded snapshot saved with the attempt.
export interface StoredResult {
  examTitle: string;
  courseId: number;
  passingScore: number;
  questions: ReviewQuestion[];
}

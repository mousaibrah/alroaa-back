// Shapes used by the exam grading rules (see exams/utils/grading.ts).

export type QuestionType = 'single_choice' | 'multiple_choice' | 'true_false';

export interface GradableQuestion {
  id: number;
  text: string;
  questionType: QuestionType;
  points: number;
  options: { id: number; optionText: string; isCorrect: boolean }[];
}

export interface AnswerInput {
  questionId: number;
  optionIds: number[];
}

export interface ReviewQuestion {
  id: number;
  text: string;
  questionType: QuestionType;
  points: number;
  earned: number;
  answered: boolean;
  correct: boolean;
  options: {
    id: number;
    text: string;
    isCorrect: boolean;
    selected: boolean;
  }[];
}

export interface Graded {
  score: number;
  maxScore: number;
  questions: ReviewQuestion[];
}

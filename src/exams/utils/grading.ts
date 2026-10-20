import { BadRequestException } from '@nestjs/common';
import type {
  GradableQuestion,
  AnswerInput,
  ReviewQuestion,
  Graded,
} from '../types/grading.types.js';

// Grading lives only on the server. The learner's browser never receives
// `isCorrect` until the attempt is submitted.

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Checks the submitted answers against the exam's own questions and options
// (never trust ids from the client) and returns the selection per question.
export const normalizeAnswers = (
  questions: GradableQuestion[],
  answers: AnswerInput[],
): Map<number, Set<number>> => {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const selected = new Map<number, Set<number>>();
  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question) {
      throw new BadRequestException(`Unknown question ${answer.questionId}`);
    }
    if (selected.has(question.id)) {
      throw new BadRequestException(`Question ${question.id} answered twice`);
    }
    const optionIds = new Set(answer.optionIds);
    if (optionIds.size !== answer.optionIds.length) {
      throw new BadRequestException(`Duplicate options for ${question.id}`);
    }
    const valid = new Set(question.options.map((o) => o.id));
    for (const id of optionIds) {
      if (!valid.has(id)) {
        throw new BadRequestException(
          `Option ${id} does not belong to question ${question.id}`,
        );
      }
    }
    if (question.questionType !== 'multiple_choice' && optionIds.size > 1) {
      throw new BadRequestException(
        `Question ${question.id} accepts a single answer`,
      );
    }
    selected.set(question.id, optionIds);
  }
  return selected;
};

// All-or-nothing per question: full points only when the selected options are
// exactly the correct ones. Unanswered questions earn nothing.
export const gradeExam = (
  questions: GradableQuestion[],
  selected: Map<number, Set<number>>,
): Graded => {
  let score = 0;
  let maxScore = 0;
  const reviewed = questions.map((q): ReviewQuestion => {
    const picks = selected.get(q.id) ?? new Set<number>();
    const correctIds = q.options.filter((o) => o.isCorrect).map((o) => o.id);
    const correct =
      picks.size === correctIds.length &&
      correctIds.every((id) => picks.has(id));
    const earned = correct ? q.points : 0;
    score += earned;
    maxScore += q.points;
    return {
      id: q.id,
      textEn: q.textEn,
      textAr: q.textAr,
      questionType: q.questionType,
      points: q.points,
      earned,
      answered: picks.size > 0,
      correct,
      options: q.options.map((o) => ({
        id: o.id,
        textEn: o.optionTextEn,
        textAr: o.optionTextAr,
        isCorrect: o.isCorrect,
        selected: picks.has(o.id),
      })),
    };
  });
  return {
    score: round2(score),
    maxScore: round2(maxScore),
    questions: reviewed,
  };
};

export const hasPassed = (score: number, passingScore: number): boolean =>
  score >= passingScore;

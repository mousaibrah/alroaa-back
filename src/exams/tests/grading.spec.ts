import { BadRequestException } from '@nestjs/common';
import { gradeExam, hasPassed, normalizeAnswers } from '../utils/grading.js';
import type { GradableQuestion } from '../types/grading.types.js';

const q = (
  id: number,
  questionType: GradableQuestion['questionType'],
  points: number,
  correct: number[],
  optionIds: number[],
): GradableQuestion => ({
  id,
  text: `Q${id}`,
  questionType,
  points,
  options: optionIds.map((o) => ({
    id: o,
    optionText: `O${o}`,
    isCorrect: correct.includes(o),
  })),
});

const questions = [
  q(1, 'single_choice', 2, [11], [10, 11, 12]),
  q(2, 'multiple_choice', 3, [20, 22], [20, 21, 22]),
  q(3, 'true_false', 1, [30], [30, 31]),
];

const grade = (picks: Record<number, number[]>) =>
  gradeExam(
    questions,
    new Map(Object.entries(picks).map(([k, v]) => [Number(k), new Set(v)])),
  );

describe('gradeExam', () => {
  it('gives full points for exactly the correct options', () => {
    const r = grade({ 1: [11], 2: [20, 22], 3: [30] });
    expect(r).toMatchObject({ score: 6, maxScore: 6 });
    expect(r.questions.every((x) => x.correct)).toBe(true);
  });

  it('scores a wrong single choice as zero', () => {
    const r = grade({ 1: [10], 2: [20, 22], 3: [30] });
    expect(r.score).toBe(4);
    expect(r.questions[0]).toMatchObject({ correct: false, earned: 0 });
  });

  it('is all-or-nothing for multiple choice', () => {
    expect(grade({ 2: [20] }).score).toBe(0); // missing one
    expect(grade({ 2: [20, 21, 22] }).score).toBe(0); // one too many
    expect(grade({ 2: [20, 22] }).score).toBe(3);
  });

  it('gives nothing for unanswered questions', () => {
    const r = grade({});
    expect(r).toMatchObject({ score: 0, maxScore: 6 });
    expect(r.questions.every((x) => !x.answered)).toBe(true);
  });

  it('reports the correct options and the learner’s selection in the review', () => {
    const r = grade({ 1: [10] });
    expect(r.questions[0].options).toEqual([
      { id: 10, text: 'O10', isCorrect: false, selected: true },
      { id: 11, text: 'O11', isCorrect: true, selected: false },
      { id: 12, text: 'O12', isCorrect: false, selected: false },
    ]);
  });
});

describe('hasPassed', () => {
  it('passes at exactly the passing score', () => {
    expect(hasPassed(4, 4)).toBe(true);
    expect(hasPassed(3.99, 4)).toBe(false);
    expect(hasPassed(0, 0)).toBe(true);
  });
});

describe('normalizeAnswers', () => {
  const run = (answers: { questionId: number; optionIds: number[] }[]) =>
    normalizeAnswers(questions, answers);

  it('accepts valid answers', () => {
    expect(run([{ questionId: 2, optionIds: [20, 21] }]).get(2)).toEqual(
      new Set([20, 21]),
    );
  });

  it('rejects unknown questions and foreign options', () => {
    expect(() => run([{ questionId: 99, optionIds: [] }])).toThrow(
      BadRequestException,
    );
    expect(() => run([{ questionId: 1, optionIds: [20] }])).toThrow(
      BadRequestException,
    );
  });

  it('rejects duplicates and several answers to a single-answer question', () => {
    expect(() =>
      run([
        { questionId: 1, optionIds: [10] },
        { questionId: 1, optionIds: [11] },
      ]),
    ).toThrow(BadRequestException);
    expect(() => run([{ questionId: 2, optionIds: [20, 20] }])).toThrow(
      BadRequestException,
    );
    expect(() => run([{ questionId: 1, optionIds: [10, 11] }])).toThrow(
      BadRequestException,
    );
    expect(() => run([{ questionId: 3, optionIds: [30, 31] }])).toThrow(
      BadRequestException,
    );
  });
});

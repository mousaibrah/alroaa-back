import { BadRequestException } from '@nestjs/common';
import type { SaveExamDto } from '../dto/exam.dto.js';
import { validateExam } from '../utils/exam-validation.js';

const exam = (
  questions: SaveExamDto['questions'],
  passingScore = 0,
): SaveExamDto => ({
  title: 'Exam',
  passingScore,
  questions,
});
const opts = (...correct: boolean[]) =>
  correct.map((isCorrect, i) => ({ optionText: `o${i}`, isCorrect }));

describe('validateExam', () => {
  it('accepts valid questions of every type', () => {
    expect(() =>
      validateExam(
        exam(
          [
            {
              text: 'a',
              questionType: 'single_choice',
              points: 2,
              options: opts(true, false, false),
            },
            {
              text: 'b',
              questionType: 'multiple_choice',
              points: 2,
              options: opts(true, true, false),
            },
            {
              text: 'c',
              questionType: 'true_false',
              points: 1,
              options: opts(false, true),
            },
          ],
          3,
        ),
      ),
    ).not.toThrow();
  });

  it.each([
    [
      'single choice with no correct answer',
      'single_choice',
      opts(false, false),
    ],
    [
      'single choice with two correct answers',
      'single_choice',
      opts(true, true),
    ],
    [
      'multiple choice with no correct answer',
      'multiple_choice',
      opts(false, false),
    ],
    ['true/false with three options', 'true_false', opts(true, false, false)],
  ] as const)('rejects %s', (_name, questionType, options) => {
    expect(() =>
      validateExam(exam([{ text: 'q', questionType, points: 1, options }])),
    ).toThrow(BadRequestException);
  });

  it('rejects a passing score above the total points', () => {
    expect(() =>
      validateExam(
        exam(
          [
            {
              text: 'q',
              questionType: 'single_choice',
              points: 1,
              options: opts(true, false),
            },
          ],
          5,
        ),
      ),
    ).toThrow(/Passing score/);
  });
});

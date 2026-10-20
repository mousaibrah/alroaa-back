import { BadRequestException } from '@nestjs/common';
import type { SaveExamDto } from '../dto/exam.dto.js';

// Rules the builder must satisfy before an exam can be saved, so a broken
// question (no correct answer, ...) never reaches the database.
export function validateExam(dto: SaveExamDto): void {
  let totalPoints = 0;

  dto.questions.forEach((question, index) => {
    const n = index + 1;
    const correct = question.options.filter((o) => o.isCorrect).length;
    totalPoints += question.points;

    if (
      question.questionType === 'true_false' &&
      question.options.length !== 2
    ) {
      throw new BadRequestException(
        `Question ${n}: a true/false question needs exactly 2 options`,
      );
    }
    if (question.questionType !== 'multiple_choice' && correct !== 1) {
      throw new BadRequestException(
        `Question ${n}: exactly one option must be correct`,
      );
    }
    if (question.questionType === 'multiple_choice' && correct < 1) {
      throw new BadRequestException(
        `Question ${n}: at least one option must be correct`,
      );
    }
  });

  if ((dto.passingScore ?? 0) > totalPoints) {
    throw new BadRequestException(
      `Passing score (${dto.passingScore}) is higher than the total points (${totalPoints})`,
    );
  }
}

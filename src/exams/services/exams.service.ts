import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { CourseAccessService } from '../../courses/services/course-access.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateExamDto, SaveExamDto } from '../dto/exam.dto.js';
import { validateExam } from '../utils/exam-validation.js';
import { ORDER } from '../../common/constants/ordering.js';

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
  ) {}

  async listForCourse(courseId: number, user: JwtPayload) {
    await this.access.courseForManage(courseId, user);
    const exams = await this.prisma.exam.findMany({
      where: { courseId, isDeleted: false },
      orderBy: { id: 'asc' },
      include: {
        questions: { where: { isDeleted: false }, select: { id: true } },
      },
    });
    return exams.map((exam) => ({
      id: exam.id,
      titleEn: exam.titleEn,
      titleAr: exam.titleAr,
      descriptionEn: exam.descriptionEn,
      descriptionAr: exam.descriptionAr,
      passingScore: Number(exam.passingScore),
      durationSec: exam.durationSec,
      questionCount: exam.questions.length,
    }));
  }

  async create(courseId: number, user: JwtPayload, dto: CreateExamDto) {
    await this.access.courseForManage(courseId, user);
    const exam = await this.prisma.exam.create({
      data: {
        courseId,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        descriptionEn: dto.descriptionEn,
        descriptionAr: dto.descriptionAr,
        passingScore: dto.passingScore ?? 0,
        durationSec: dto.durationSec,
      },
    });
    return this.load(exam.id);
  }

  // Full exam including the correct answers: management view only.
  async get(id: number, user: JwtPayload) {
    await this.access.examForManage(id, user);
    return this.load(id);
  }

  async save(id: number, user: JwtPayload, dto: SaveExamDto) {
    await this.access.examForManage(id, user);
    validateExam(dto);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.question.findMany({
        where: { examId: id, isDeleted: false },
        include: { options: { where: { isDeleted: false } } },
      });
      const existingById = new Map(existing.map((q) => [q.id, q]));

      // Ids from the client must belong to this exam: never trust them blindly.
      for (const q of dto.questions) {
        if (q.id !== undefined && !existingById.has(q.id)) {
          throw new BadRequestException(`Unknown question id ${q.id}`);
        }
        const ownOptions = new Set(
          (q.id !== undefined ? existingById.get(q.id)!.options : []).map(
            (o) => o.id,
          ),
        );
        for (const o of q.options) {
          if (o.id !== undefined && !ownOptions.has(o.id)) {
            throw new BadRequestException(`Unknown option id ${o.id}`);
          }
        }
      }

      await tx.exam.update({
        where: { id },
        data: {
          titleEn: dto.titleEn,
          titleAr: dto.titleAr,
          descriptionEn: dto.descriptionEn ?? null,
          descriptionAr: dto.descriptionAr ?? null,
          passingScore: dto.passingScore ?? 0,
          durationSec: dto.durationSec ?? null,
        },
      });

      // Questions missing from the request were removed in the builder.
      const keptQuestionIds = new Set(
        dto.questions.flatMap((q) => (q.id !== undefined ? [q.id] : [])),
      );
      const removed = existing
        .filter((q) => !keptQuestionIds.has(q.id))
        .map((q) => q.id);
      if (removed.length) {
        await tx.questionOption.updateMany({
          where: { questionId: { in: removed } },
          data: { isDeleted: true },
        });
        await tx.question.updateMany({
          where: { id: { in: removed } },
          data: { isDeleted: true },
        });
      }

      for (const [qIndex, q] of dto.questions.entries()) {
        const questionData = {
          textEn: q.textEn,
          textAr: q.textAr,
          questionType: q.questionType,
          points: q.points,
          sortOrder: qIndex,
        };
        const questionId =
          q.id !== undefined
            ? (
                await tx.question.update({
                  where: { id: q.id },
                  data: questionData,
                })
              ).id
            : (
                await tx.question.create({
                  data: { ...questionData, examId: id },
                })
              ).id;

        const keptOptionIds = new Set(
          q.options.flatMap((o) => (o.id !== undefined ? [o.id] : [])),
        );
        if (q.id !== undefined) {
          await tx.questionOption.updateMany({
            where: {
              questionId,
              isDeleted: false,
              id: { notIn: [...keptOptionIds] },
            },
            data: { isDeleted: true },
          });
        }
        for (const [oIndex, o] of q.options.entries()) {
          const optionData = {
            optionTextEn: o.optionTextEn,
            optionTextAr: o.optionTextAr,
            isCorrect: o.isCorrect,
            sortOrder: oIndex,
          };
          if (o.id !== undefined) {
            await tx.questionOption.update({
              where: { id: o.id },
              data: optionData,
            });
          } else {
            await tx.questionOption.create({
              data: { ...optionData, questionId },
            });
          }
        }
      }
    });

    return this.load(id);
  }

  async remove(id: number, user: JwtPayload): Promise<void> {
    await this.access.examForManage(id, user);
    await this.prisma.exam.update({ where: { id }, data: { isDeleted: true } });
  }

  private async load(id: number) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, isDeleted: false },
      include: {
        questions: {
          where: { isDeleted: false },
          orderBy: ORDER,
          include: { options: { where: { isDeleted: false }, orderBy: ORDER } },
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return {
      id: exam.id,
      courseId: exam.courseId,
      titleEn: exam.titleEn,
      titleAr: exam.titleAr,
      descriptionEn: exam.descriptionEn,
      descriptionAr: exam.descriptionAr,
      passingScore: Number(exam.passingScore),
      durationSec: exam.durationSec,
      questions: exam.questions.map((q) => ({
        id: q.id,
        textEn: q.textEn,
        textAr: q.textAr,
        questionType: q.questionType,
        points: Number(q.points),
        options: q.options.map((o) => ({
          id: o.id,
          optionTextEn: o.optionTextEn,
          optionTextAr: o.optionTextAr,
          isCorrect: o.isCorrect,
        })),
      })),
    };
  }
}

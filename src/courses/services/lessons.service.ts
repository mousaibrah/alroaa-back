import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CourseAccessService } from './course-access.service.js';
import type { CreateLessonDto, UpdateLessonDto } from '../dto/lesson.dto.js';
import { assertSameIds } from '../utils/reorder.util.js';

@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
  ) {}

  // New lessons go to the end of the section.
  async create(sectionId: number, user: JwtPayload, dto: CreateLessonDto) {
    await this.access.sectionForManage(sectionId, user);
    const last = await this.prisma.lesson.aggregate({
      where: { sectionId, isDeleted: false },
      _max: { sortOrder: true },
    });
    return this.prisma.lesson.create({
      data: {
        sectionId,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        descriptionEn: dto.descriptionEn,
        descriptionAr: dto.descriptionAr,
        lessonType: dto.lessonType,
        contentUrlEn: dto.contentUrlEn,
        contentUrlAr: dto.contentUrlAr,
        durationSec: dto.durationSec,
        isPreview: dto.isPreview ?? false,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
  }

  async update(id: number, user: JwtPayload, dto: UpdateLessonDto) {
    await this.access.lessonForManage(id, user);
    return this.prisma.lesson.update({
      where: { id },
      data: {
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        descriptionEn: dto.descriptionEn,
        descriptionAr: dto.descriptionAr,
        lessonType: dto.lessonType,
        contentUrlEn: dto.contentUrlEn,
        contentUrlAr: dto.contentUrlAr,
        durationSec: dto.durationSec,
        isPreview: dto.isPreview,
      },
    });
  }

  async remove(id: number, user: JwtPayload): Promise<void> {
    await this.access.lessonForManage(id, user);
    await this.prisma.lesson.update({
      where: { id },
      data: { isDeleted: true },
    });
  }

  async reorder(sectionId: number, user: JwtPayload, ids: number[]) {
    await this.access.sectionForManage(sectionId, user);
    const siblings = await this.prisma.lesson.findMany({
      where: { sectionId, isDeleted: false },
      select: { id: true },
    });
    assertSameIds(
      siblings.map((l) => l.id),
      ids,
    );
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.lesson.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return { ids };
  }
}

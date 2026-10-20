import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CourseAccessService } from './course-access.service.js';
import type { CreateSectionDto, UpdateSectionDto } from '../dto/section.dto.js';
import { assertSameIds } from '../utils/reorder.util.js';

@Injectable()
export class SectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
  ) {}

  // New sections go to the end of the course.
  async create(courseId: number, user: JwtPayload, dto: CreateSectionDto) {
    await this.access.courseForManage(courseId, user);
    const last = await this.prisma.courseSection.aggregate({
      where: { courseId, isDeleted: false },
      _max: { sortOrder: true },
    });
    return this.prisma.courseSection.create({
      data: {
        courseId,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        descriptionEn: dto.descriptionEn,
        descriptionAr: dto.descriptionAr,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
  }

  async update(id: number, user: JwtPayload, dto: UpdateSectionDto) {
    await this.access.sectionForManage(id, user);
    return this.prisma.courseSection.update({
      where: { id },
      data: {
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        descriptionEn: dto.descriptionEn,
        descriptionAr: dto.descriptionAr,
      },
    });
  }

  // Soft delete: the section and its lessons are hidden, not removed.
  async remove(id: number, user: JwtPayload): Promise<void> {
    await this.access.sectionForManage(id, user);
    await this.prisma.$transaction([
      this.prisma.lesson.updateMany({
        where: { sectionId: id },
        data: { isDeleted: true },
      }),
      this.prisma.courseSection.update({
        where: { id },
        data: { isDeleted: true },
      }),
    ]);
  }

  async reorder(courseId: number, user: JwtPayload, ids: number[]) {
    await this.access.courseForManage(courseId, user);
    const siblings = await this.prisma.courseSection.findMany({
      where: { courseId, isDeleted: false },
      select: { id: true },
    });
    assertSameIds(
      siblings.map((s) => s.id),
      ids,
    );
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.courseSection.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return { ids };
  }
}

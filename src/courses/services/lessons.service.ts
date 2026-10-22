import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { MediaService } from '../../media/services/media.service.js';
import { contentRef } from '../../media/utils/lesson-content.util.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CourseAccessService } from './course-access.service.js';
import type { LessonType } from '../../generated/prisma/enums.js';
import type { CreateLessonDto, UpdateLessonDto } from '../dto/lesson.dto.js';
import { assertSameIds } from '../utils/reorder.util.js';

@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly media: MediaService,
  ) {}

  // Validates the media a lesson points at and returns the duration to fill in
  // when none was given (the first video found, English first).
  private async checkMedia(
    lessonType: LessonType,
    isPreview: boolean,
    ids: (string | null | undefined)[],
    user: JwtPayload,
  ): Promise<number | undefined> {
    let durationSec: number | undefined;
    for (const id of ids) {
      if (!id) continue;
      const media = await this.media.assertAttachable(
        id,
        lessonType,
        isPreview,
        user,
      );
      durationSec ??= media.durationSec ?? undefined;
    }
    return lessonType === 'video' ? durationSec : undefined;
  }

  private withContent<
    L extends {
      contentUrlEn: string | null;
      contentUrlAr: string | null;
      contentMediaEnId: string | null;
      contentMediaArId: string | null;
    },
  >(lesson: L) {
    return {
      ...lesson,
      content: {
        en: contentRef(lesson.contentMediaEnId, lesson.contentUrlEn),
        ar: contentRef(lesson.contentMediaArId, lesson.contentUrlAr),
      },
    };
  }

  // New lessons go to the end of the section.
  async create(sectionId: number, user: JwtPayload, dto: CreateLessonDto) {
    await this.access.sectionForManage(sectionId, user);
    const last = await this.prisma.lesson.aggregate({
      where: { sectionId, isDeleted: false },
      _max: { sortOrder: true },
    });
    const isPreview = dto.isPreview ?? false;
    const mediaDuration = await this.checkMedia(
      dto.lessonType,
      isPreview,
      [dto.contentMediaEnId, dto.contentMediaArId],
      user,
    );
    const lesson = await this.prisma.lesson.create({
      data: {
        sectionId,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        descriptionEn: dto.descriptionEn,
        descriptionAr: dto.descriptionAr,
        lessonType: dto.lessonType,
        contentUrlEn: dto.contentUrlEn,
        contentUrlAr: dto.contentUrlAr,
        contentMediaEnId: dto.contentMediaEnId,
        contentMediaArId: dto.contentMediaArId,
        durationSec: dto.durationSec ?? mediaDuration,
        isPreview,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    return this.withContent(lesson);
  }

  async update(id: number, user: JwtPayload, dto: UpdateLessonDto) {
    const current = await this.access.lessonForManage(id, user);
    // Re-check the media whenever it, the type or the preview flag changes: a
    // video behind the paywall must be private.
    const mediaChanged =
      dto.contentMediaEnId !== undefined ||
      dto.contentMediaArId !== undefined ||
      dto.lessonType !== undefined ||
      dto.isPreview !== undefined;
    const mediaEnId =
      dto.contentMediaEnId === undefined
        ? current.contentMediaEnId
        : dto.contentMediaEnId;
    const mediaArId =
      dto.contentMediaArId === undefined
        ? current.contentMediaArId
        : dto.contentMediaArId;
    const mediaDuration = mediaChanged
      ? await this.checkMedia(
          dto.lessonType ?? current.lessonType,
          dto.isPreview ?? current.isPreview,
          [mediaEnId, mediaArId],
          user,
        )
      : undefined;
    const lesson = await this.prisma.lesson.update({
      where: { id },
      data: {
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        descriptionEn: dto.descriptionEn,
        descriptionAr: dto.descriptionAr,
        lessonType: dto.lessonType,
        contentUrlEn: dto.contentUrlEn,
        contentUrlAr: dto.contentUrlAr,
        contentMediaEnId: dto.contentMediaEnId,
        contentMediaArId: dto.contentMediaArId,
        // Only fills an empty duration from the video; never overwrites one.
        durationSec:
          dto.durationSec ??
          (current.durationSec === null ? mediaDuration : undefined),
        isPreview: dto.isPreview,
      },
    });
    return this.withContent(lesson);
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

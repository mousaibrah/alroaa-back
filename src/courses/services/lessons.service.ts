import { BadRequestException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import {
  MediaService,
  type TempFile,
} from '../../media/services/media.service.js';
import { contentStatus } from '../../media/utils/lesson-content.util.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CourseAccessService } from './course-access.service.js';
import type { LessonType, MediaType } from '../../generated/prisma/enums.js';
import type { CreateLessonDto, UpdateLessonDto } from '../dto/lesson.dto.js';
import { assertSameIds } from '../utils/reorder.util.js';

const WITH_STATUS = {
  contentMedia: { select: { status: true } },
} as const;

// What each lesson type holds.
const FILE_TYPE = { video: 'video', text: 'image' } as const satisfies Record<
  LessonType,
  MediaType
>;

@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly media: MediaService,
  ) {}

  private withStatus<
    L extends {
      contentUrl: string | null;
      contentMedia: { status: string } | null;
    },
  >({ contentMedia, ...lesson }: L) {
    return {
      ...lesson,
      contentStatus: contentStatus({
        contentUrl: lesson.contentUrl,
        contentMedia,
      }),
    };
  }

  // New lessons go to the end of the section. contentUrl points at the uploaded
  // file right away; contentStatus stays "processing" until the web MP4 is made.
  async create(
    sectionId: number,
    user: JwtPayload,
    dto: CreateLessonDto,
    file?: TempFile,
  ) {
    await this.access.sectionForManage(sectionId, user);
    if (!file) {
      throw new BadRequestException(
        'Upload the lesson file in the `file` field',
      );
    }
    const last = await this.prisma.lesson.aggregate({
      where: { sectionId, isDeleted: false },
      _max: { sortOrder: true },
    });
    const lesson = await this.media.withUpload(
      file,
      FILE_TYPE[dto.lessonType],
      user,
      (stored) =>
        this.prisma.lesson.create({
          data: {
            sectionId,
            titleEn: dto.titleEn,
            titleAr: dto.titleAr,
            descriptionEn: dto.descriptionEn,
            descriptionAr: dto.descriptionAr,
            lessonType: dto.lessonType,
            contentUrl: stored?.url,
            contentMediaId: stored?.mediaId,
            // Left empty, it is filled from the video.
            durationSec: dto.durationSec,
            isPreview: dto.isPreview ?? false,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
          include: WITH_STATUS,
        }),
    );
    return this.withStatus(lesson);
  }

  // A new file replaces the content and the old file is deleted.
  async update(
    id: number,
    user: JwtPayload,
    dto: UpdateLessonDto,
    file?: TempFile,
  ) {
    const current = await this.access.lessonForManage(id, user);
    const lessonType = dto.lessonType ?? current.lessonType;
    const hasContent =
      current.contentUrl !== null || current.contentMediaId !== null;
    if (!file && lessonType !== current.lessonType && hasContent) {
      throw new BadRequestException(
        'Upload a new file when changing the lesson type',
      );
    }
    const lesson = await this.media.withUpload(
      file,
      FILE_TYPE[lessonType],
      user,
      (stored) =>
        this.prisma.lesson.update({
          where: { id },
          data: {
            titleEn: dto.titleEn,
            titleAr: dto.titleAr,
            descriptionEn: dto.descriptionEn,
            descriptionAr: dto.descriptionAr,
            lessonType: dto.lessonType,
            ...(stored
              ? { contentMediaId: stored.mediaId, contentUrl: stored.url }
              : {}),
            durationSec: dto.durationSec,
            isPreview: dto.isPreview,
          },
          include: WITH_STATUS,
        }),
    );
    if (file && current.contentMediaId) {
      await this.media
        .removeIfUnused(current.contentMediaId)
        .catch(() => undefined);
    }
    return this.withStatus(lesson);
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

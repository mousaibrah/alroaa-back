import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { Media } from '../../generated/prisma/client.js';
import type { MediaType } from '../../generated/prisma/enums.js';
import { UserRole } from '../../users/types/user-role.enum.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ListMediaQueryDto, PresignMediaDto } from '../dto/media.dto.js';
import {
  METADATA_GET_TTL_SEC,
  PLAYBACK_GET_TTL_SEC,
  PRESIGN_PUT_TTL_SEC,
} from '../media.constants.js';
import { buildMediaKey, validateUpload } from '../utils/media.util.js';
import { MediaQueueService } from './media-queue.service.js';
import { StorageService } from './storage.service.js';

// A file multer saved to a temp path (multipart lesson uploads).
export interface TempFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export type MediaVariants = Record<
  string,
  { key: string; width?: number; height?: number }
>;

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: MediaQueueService,
  ) {}

  // A file sent with a form (lesson content, course cover and intro, profile
  // picture): stored in the public part of the bucket as an UPLOADED media
  // item. Use `withUpload`. `user` is null for a sign-up (see `setOwner`).
  private async storeFile(
    file: TempFile,
    expected: MediaType,
    user: JwtPayload | null,
  ): Promise<Media> {
    const { type, ext } = validateUpload(file.mimetype, file.size);
    if (type !== expected) {
      throw new BadRequestException(
        `The file must be ${expected === 'image' ? 'an' : 'a'} ${expected}`,
      );
    }
    const id = randomUUID();
    const key = buildMediaKey(id, ext, false);
    await this.storage.putObject(
      key,
      createReadStream(file.path),
      file.mimetype,
      file.size,
    );
    return this.prisma.media.create({
      data: {
        id,
        ownerId: user?.sub ?? null,
        key,
        type,
        mimeType: file.mimetype,
        size: BigInt(file.size),
        originalName: file.originalname.slice(0, 255),
        status: 'uploaded',
      },
    });
  }

  // Stores the uploaded file, runs `save` with its media id and public URL,
  // then queues the processing (web MP4 and duration for videos, WebP sizes for
  // images). The temp file is always removed; if saving fails the stored file
  // is too. Without a file, `save` runs with nothing.
  async withUpload<T>(
    file: TempFile | undefined,
    expected: MediaType,
    user: JwtPayload | null,
    save: (stored?: { mediaId: string; url: string }) => Promise<T>,
  ): Promise<T> {
    if (!file) return save();
    try {
      const media = await this.storeFile(file, expected, user);
      let saved: T;
      try {
        saved = await save({
          mediaId: media.id,
          url: this.storage.getPublicUrl(media.key),
        });
      } catch (error) {
        await this.removeIfUnused(media.id).catch(() => undefined);
        throw error;
      }
      await this.queue.enqueue(media.id);
      return saved;
    } finally {
      await rm(file.path, { force: true });
    }
  }

  enqueue(id: string): Promise<void> {
    return this.queue.enqueue(id);
  }

  // A picture uploaded at sign-up belongs to the account once it exists.
  async setOwner(id: string, ownerId: number): Promise<void> {
    await this.prisma.media.update({ where: { id }, data: { ownerId } });
  }

  // How many lessons, courses (cover or intro) and users point at a media item;
  // `liveOnly` skips soft-deleted lessons and courses.
  private async usageCount(id: string, liveOnly: boolean): Promise<number> {
    const live = liveOnly ? { isDeleted: false } : {};
    const counts = await Promise.all([
      this.prisma.lesson.count({ where: { ...live, contentMediaId: id } }),
      this.prisma.course.count({
        where: {
          ...live,
          OR: [{ thumbnailMediaId: id }, { introVideoMediaId: id }],
        },
      }),
      this.prisma.user.count({ where: { imageMediaId: id } }),
    ]);
    return counts.reduce((a, b) => a + b, 0);
  }

  // Deletes a media item and its files once nothing uses it.
  async removeIfUnused(id: string): Promise<void> {
    if ((await this.usageCount(id, false)) > 0) return;
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) return;
    await this.storage.deleteObjects(this.keysOf(media));
    await this.prisma.media.delete({ where: { id } });
  }

  private canAccess(user: JwtPayload, media: Pick<Media, 'ownerId'>): boolean {
    return user.role === UserRole.ADMIN || media.ownerId === user.sub;
  }

  private async findOwned(id: string, user: JwtPayload): Promise<Media> {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');
    if (!this.canAccess(user, media)) {
      throw new ForbiddenException('You can only access your own media');
    }
    return media;
  }

  async presign(user: JwtPayload, dto: PresignMediaDto) {
    const { type, ext } = validateUpload(dto.mimeType, dto.size);
    const isPrivate = dto.isPrivate ?? false;
    const id = randomUUID();
    const key = buildMediaKey(id, ext, isPrivate);
    await this.prisma.media.create({
      data: {
        id,
        ownerId: user.sub,
        key,
        type,
        mimeType: dto.mimeType,
        size: BigInt(dto.size),
        originalName: dto.filename,
        isPrivate,
      },
    });
    const url = await this.storage.createPresignedPutUrl(
      key,
      dto.mimeType,
      dto.size,
    );
    return {
      mediaId: id,
      key,
      url,
      method: 'PUT' as const,
      headers: { 'Content-Type': dto.mimeType },
      expiresIn: PRESIGN_PUT_TTL_SEC,
    };
  }

  async confirm(id: string, user: JwtPayload) {
    const media = await this.findOwned(id, user);
    if (media.status !== 'pending') return this.toResponse(media);

    const head = await this.storage.headObject(media.key);
    if (!head) throw new BadRequestException('The file has not been uploaded');

    const sameType =
      head.contentType?.split(';')[0].trim().toLowerCase() === media.mimeType;
    if (head.size !== Number(media.size) || !sameType) {
      await this.storage.deleteObjects([media.key]);
      await this.prisma.media.update({
        where: { id },
        data: {
          status: 'failed',
          failureReason:
            'Uploaded file does not match the declared size or type',
        },
      });
      throw new BadRequestException(
        'Uploaded file does not match the declared size or type',
      );
    }

    const updated = await this.prisma.media.update({
      where: { id },
      data: { status: 'uploaded' },
    });
    await this.queue.enqueue(id);
    return this.toResponse(updated);
  }

  async get(id: string, user: JwtPayload) {
    return this.toResponse(
      await this.findOwned(id, user),
      METADATA_GET_TTL_SEC,
    );
  }

  async list(user: JwtPayload, query: ListMediaQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = user.role === UserRole.ADMIN ? {} : { ownerId: user.sub };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.media.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.media.count({ where }),
    ]);
    return {
      items: await Promise.all(
        rows.map((row) => this.toResponse(row, METADATA_GET_TTL_SEC)),
      ),
      total,
      page,
      limit,
    };
  }

  async remove(id: string, user: JwtPayload): Promise<void> {
    const media = await this.findOwned(id, user);
    if ((await this.usageCount(id, true)) > 0) {
      throw new ConflictException(
        'This media is used by a lesson, course or profile',
      );
    }
    await this.storage.deleteObjects(this.keysOf(media));
    await this.prisma.media.delete({ where: { id } });
  }

  // Every object of a media item: original, thumbnail and variants.
  keysOf(media: Pick<Media, 'key' | 'thumbnailKey' | 'variants'>): string[] {
    const variants = (media.variants ?? {}) as MediaVariants;
    const keys = [
      media.key,
      media.thumbnailKey,
      ...Object.values(variants).map((v) => v.key),
    ];
    return [...new Set(keys.filter((k): k is string => !!k))];
  }

  publicUrl(key: string): string {
    return this.storage.getPublicUrl(key);
  }

  // The URL a browser may use now: signed for private media, public otherwise.
  urlFor(
    media: Pick<Media, 'isPrivate'>,
    key: string,
    ttlSec: number,
  ): Promise<string> | string {
    return media.isPrivate
      ? this.storage.createPresignedGetUrl(key, ttlSec)
      : this.storage.getPublicUrl(key);
  }

  // The web-friendly MP4 (or the original) as a playback source.
  async playbackSource(
    media: Pick<Media, 'status' | 'key' | 'isPrivate' | 'variants'>,
  ): Promise<{ url: string; kind: 'file'; expiresAt: string | null }> {
    if (media.status !== 'ready') {
      throw new NotFoundException('This video is not ready yet');
    }
    const variants = (media.variants ?? {}) as MediaVariants;
    const url = await this.urlFor(
      media,
      variants.mp4?.key ?? media.key,
      PLAYBACK_GET_TTL_SEC,
    );
    return {
      url,
      kind: 'file',
      expiresAt: media.isPrivate
        ? new Date(Date.now() + PLAYBACK_GET_TTL_SEC * 1000).toISOString()
        : null,
    };
  }

  async toResponse(media: Media, ttlSec: number = METADATA_GET_TTL_SEC) {
    const variants = (media.variants ?? {}) as MediaVariants;
    const urls: Record<string, string> = {
      original: await this.urlFor(media, media.key, ttlSec),
    };
    for (const [name, variant] of Object.entries(variants)) {
      urls[name] = await this.urlFor(media, variant.key, ttlSec);
    }
    return {
      id: media.id,
      ownerId: media.ownerId,
      type: media.type,
      mimeType: media.mimeType,
      size: Number(media.size),
      originalName: media.originalName,
      status: media.status,
      width: media.width,
      height: media.height,
      durationSec: media.durationSec,
      isPrivate: media.isPrivate,
      failureReason: media.failureReason,
      thumbnailUrl: media.thumbnailKey
        ? await this.urlFor(media, media.thumbnailKey, ttlSec)
        : null,
      urls,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
    };
  }

  // Used by the maintenance job: drop abandoned uploads.
  async discard(media: Media): Promise<void> {
    try {
      await this.storage.deleteObjects(this.keysOf(media));
    } catch (error) {
      this.logger.warn(
        `Could not delete objects of ${media.id}: ${String(error)}`,
      );
    }
    await this.prisma.media.delete({ where: { id: media.id } });
  }
}

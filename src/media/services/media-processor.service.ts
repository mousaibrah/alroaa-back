import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Injectable, Logger } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import type { Media } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { variantKey } from '../utils/media.util.js';
import { StorageService } from './storage.service.js';

type Variants = Record<
  string,
  { key: string; width?: number; height?: number }
>;

interface Processed {
  width: number | null;
  height: number | null;
  durationSec: number | null;
  thumbnailKey: string;
  variants: Variants;
  size?: number;
}

const SHARP_FORMAT = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

const probe = (path: string) =>
  new Promise<ffmpeg.FfprobeData>((resolve, reject) =>
    ffmpeg.ffprobe(path, (err, data) => (err ? reject(err) : resolve(data))),
  );

// ffmpeg runs at low priority so it does not starve the API.
const run = (command: ffmpeg.FfmpegCommand) =>
  new Promise<void>((resolve, reject) =>
    command
      .renice(10)
      .on('end', () => resolve())
      .on('error', reject)
      .run(),
  );

@Injectable()
export class MediaProcessorService {
  private readonly logger = new Logger(MediaProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // One attempt at processing. A failed attempt puts the item back to UPLOADED
  // so the retry can claim it; the last one marks it FAILED.
  async process(mediaId: string, finalAttempt: boolean): Promise<void> {
    // Claim it: a duplicate job (or an already finished item) does nothing.
    const claimed = await this.prisma.media.updateMany({
      where: { id: mediaId, status: 'uploaded' },
      data: { status: 'processing', failureReason: null },
    });
    if (claimed.count === 0) return;

    const media = await this.prisma.media.findUniqueOrThrow({
      where: { id: mediaId },
    });
    const dir = await mkdtemp(join(tmpdir(), 'media-'));
    try {
      const result =
        media.type === 'image'
          ? await this.processImage(media, dir)
          : await this.processVideo(media, dir);
      await this.prisma.$transaction([
        this.prisma.media.update({
          where: { id: mediaId },
          data: {
            status: 'ready',
            width: result.width,
            height: result.height,
            durationSec: result.durationSec,
            thumbnailKey: result.thumbnailKey,
            variants: result.variants,
            ...(result.size === undefined ? {} : { size: BigInt(result.size) }),
          },
        }),
        ...this.fillLessons(media, result),
      ]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Processing ${mediaId} failed: ${reason}`);
      await this.prisma.media.update({
        where: { id: mediaId },
        data: finalAttempt
          ? { status: 'failed', failureReason: reason.slice(0, 500) }
          : { status: 'uploaded' },
      });
      throw error;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // Lessons using this (public) file get its URL, the web MP4 for videos, and
  // its duration when they have none.
  private fillLessons(media: Media, result: Processed) {
    if (media.isPrivate) return [];
    const url = this.storage.getPublicUrl(
      result.variants.mp4?.key ?? media.key,
    );
    const updates = [
      this.prisma.lesson.updateMany({
        where: { contentMediaId: media.id },
        data: { contentUrl: url },
      }),
    ];
    if (result.durationSec !== null) {
      updates.push(
        this.prisma.lesson.updateMany({
          where: { contentMediaId: media.id, durationSec: null },
          data: { durationSec: result.durationSec },
        }),
      );
    }
    return updates;
  }

  private async download(media: Media, dir: string): Promise<string> {
    const path = join(dir, 'source');
    await pipeline(
      await this.storage.getObjectStream(media.key),
      createWriteStream(path),
    );
    return path;
  }

  private async upload(key: string, path: string, contentType: string) {
    const { size } = await stat(path);
    await this.storage.putObject(
      key,
      createReadStream(path),
      contentType,
      size,
    );
    return size;
  }

  // Thumbnail (320) and medium (1280) WebP, written as temp files and uploaded.
  private async webpVariants(
    media: Media,
    source: string,
    dir: string,
    mediumName: string,
  ) {
    const variants: Variants = {};
    const thumbnailKey = variantKey(media.key, 'thumb.webp');
    for (const [name, key, width] of [
      ['thumb', thumbnailKey, 320],
      [mediumName, variantKey(media.key, `${mediumName}.webp`), 1280],
    ] as const) {
      const out = join(dir, `${name}.webp`);
      const info = await sharp(source)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(out);
      await this.upload(key, out, 'image/webp');
      if (name !== 'thumb') {
        variants[name] = { key, width: info.width, height: info.height };
      }
    }
    return { thumbnailKey, variants };
  }

  private async processImage(media: Media, dir: string): Promise<Processed> {
    const source = await this.download(media, dir);
    const meta = await sharp(source).metadata();
    // EXIF orientation 5-8 means the stored width/height are swapped.
    const swap = (meta.orientation ?? 1) >= 5;
    const width = (swap ? meta.height : meta.width) ?? null;
    const height = (swap ? meta.width : meta.height) ?? null;

    // Re-encode the original in its own format: this applies the orientation
    // and drops EXIF/GPS. GIFs are left alone to keep their animation.
    let size: number | undefined;
    const format = SHARP_FORMAT[media.mimeType as keyof typeof SHARP_FORMAT];
    if (format) {
      const clean = join(dir, 'clean');
      await sharp(source).rotate().toFormat(format).toFile(clean);
      size = await this.upload(media.key, clean, media.mimeType);
    }

    const { thumbnailKey, variants } = await this.webpVariants(
      media,
      source,
      dir,
      'medium',
    );
    return { width, height, durationSec: null, thumbnailKey, variants, size };
  }

  private async processVideo(media: Media, dir: string): Promise<Processed> {
    const source = await this.download(media, dir);
    const info = await probe(source);
    const video = info.streams.find((s) => s.codec_type === 'video');
    const audio = info.streams.find((s) => s.codec_type === 'audio');
    if (!video) throw new Error('The file has no video stream');
    const duration = Number(info.format.duration) || 0;

    // Poster frame at ~1s (the start, for very short clips).
    const frame = join(dir, 'frame.jpg');
    await run(
      ffmpeg(source)
        .seekInput(duration > 1 ? 1 : 0)
        .frames(1)
        .outputOptions(['-q:v', '2'])
        .output(frame),
    );
    const { thumbnailKey, variants } = await this.webpVariants(
      media,
      frame,
      dir,
      'poster',
    );

    // Already H.264/AAC in an MP4-family container: just remux with faststart.
    const webReady =
      (info.format.format_name ?? '').includes('mp4') &&
      video.codec_name === 'h264' &&
      video.pix_fmt === 'yuv420p' &&
      (!audio || audio.codec_name === 'aac');
    const mp4 = join(dir, 'web.mp4');
    const command = ffmpeg(source).output(mp4);
    if (webReady) {
      command.outputOptions(['-c', 'copy']);
    } else {
      command.videoCodec('libx264').audioCodec('aac').outputOptions([
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        // yuv420p needs even dimensions
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      ]);
    }
    command.outputOptions(['-movflags', '+faststart', '-map_metadata', '-1']);
    await run(command);

    const mp4Key = variantKey(media.key, 'web.mp4');
    await this.upload(mp4Key, mp4, 'video/mp4');
    variants.mp4 = {
      key: mp4Key,
      width: video.width,
      height: video.height,
    };

    return {
      width: video.width ?? null,
      height: video.height ?? null,
      durationSec: Math.round(duration),
      thumbnailKey,
      variants,
    };
  }
}

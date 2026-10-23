import { BadRequestException } from '@nestjs/common';
import type { MediaType } from '../../generated/prisma/enums.js';
import {
  ALLOWED_MIME,
  MULTIPART_MAX_PARTS,
  MULTIPART_PART_SIZE,
} from '../media.constants.js';

const MB = 1024 * 1024;

const envMb = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const sizeLimits = () => ({
  image: envMb('MAX_IMAGE_SIZE_MB', 10) * MB,
  video: envMb('MAX_VIDEO_SIZE_MB', 1024) * MB,
});

// Checks the declared MIME type and size; returns what the key needs.
export const validateUpload = (
  mimeType: string,
  size: number,
  limits = sizeLimits(),
): { type: MediaType; ext: string } => {
  const allowed = ALLOWED_MIME[mimeType];
  if (!allowed) {
    throw new BadRequestException(`Unsupported file type: ${mimeType}`);
  }
  if (!Number.isInteger(size) || size <= 0) {
    throw new BadRequestException('Invalid file size');
  }
  if (size > limits[allowed.type]) {
    throw new BadRequestException(
      `File is too large (max ${limits[allowed.type] / MB} MB for ${allowed.type}s)`,
    );
  }
  return allowed;
};

// 16 MB parts, larger (whole MBs) when the file would need over 10,000.
export const multipartPartSize = (size: number): number =>
  Math.max(
    MULTIPART_PART_SIZE,
    Math.ceil(size / MULTIPART_MAX_PARTS / MB) * MB,
  );

// media/{yyyy}/{mm}/{uuid}.{ext}. Private files live under `private/` so the
// bucket policy can make `media/*` public without exposing them.
export const buildMediaKey = (
  id: string,
  ext: string,
  isPrivate: boolean,
  now: Date = new Date(),
): string => {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${isPrivate ? 'private/' : ''}media/${yyyy}/${mm}/${id}.${ext}`;
};

// Variants sit next to the original: media/2026/10/{uuid}/thumb.webp
export const variantKey = (key: string, name: string): string =>
  `${key.replace(/\.[^./]+$/, '')}/${name}`;

// pg-boss takes a plain libpq-style URL; `?schema=` is a Prisma-only parameter
// (pg-boss keeps its own tables in the `pgboss` schema).
export const pgBossConnectionString = (databaseUrl: string): string => {
  const url = new URL(databaseUrl);
  url.searchParams.delete('schema');
  return url.toString();
};

export const allowedOrigins = (): string[] =>
  (
    process.env.CORS_ALLOWED_ORIGINS ??
    process.env.CORS_ORIGIN ??
    'http://localhost:3000,http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

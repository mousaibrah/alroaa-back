import { BadRequestException } from '@nestjs/common';
import {
  buildMediaKey,
  pgBossConnectionString,
  validateUpload,
  variantKey,
} from '../utils/media.util.js';

const MB = 1024 * 1024;
const limits = { image: 10 * MB, video: 100 * MB };

describe('validateUpload', () => {
  it('accepts allowed types within the limit', () => {
    expect(validateUpload('image/png', 1000, limits)).toEqual({
      type: 'image',
      ext: 'png',
    });
    expect(validateUpload('video/quicktime', 50 * MB, limits)).toEqual({
      type: 'video',
      ext: 'mov',
    });
  });

  it('rejects other MIME types', () => {
    expect(() => validateUpload('application/pdf', 10, limits)).toThrow(
      BadRequestException,
    );
    expect(() => validateUpload('image/svg+xml', 10, limits)).toThrow(
      BadRequestException,
    );
  });

  it('rejects files over the per-type limit and invalid sizes', () => {
    expect(() => validateUpload('image/jpeg', 11 * MB, limits)).toThrow(
      /too large/,
    );
    expect(() => validateUpload('video/mp4', 11 * MB, limits)).not.toThrow();
    expect(() => validateUpload('video/mp4', 0, limits)).toThrow(
      BadRequestException,
    );
    expect(() => validateUpload('video/mp4', 1.5, limits)).toThrow(
      BadRequestException,
    );
  });
});

describe('storage keys', () => {
  const id = '3f2b8c1e-0000-4000-8000-000000000001';
  const now = new Date(Date.UTC(2026, 9, 22));

  it('builds media/{yyyy}/{mm}/{uuid}.{ext} and never uses the filename', () => {
    expect(buildMediaKey(id, 'mp4', false, now)).toBe(
      `media/2026/10/${id}.mp4`,
    );
  });

  it('puts private files under private/', () => {
    expect(buildMediaKey(id, 'jpg', true, now)).toBe(
      `private/media/2026/10/${id}.jpg`,
    );
  });

  it('places variants next to the original', () => {
    expect(variantKey(`media/2026/10/${id}.mp4`, 'thumb.webp')).toBe(
      `media/2026/10/${id}/thumb.webp`,
    );
  });
});

describe('pgBossConnectionString', () => {
  it('drops the Prisma-only schema parameter and keeps the rest', () => {
    const out = new URL(
      pgBossConnectionString(
        'postgresql://u:p@localhost:5432/db?schema=public&sslmode=disable',
      ),
    );
    expect(out.searchParams.has('schema')).toBe(false);
    expect(out.searchParams.get('sslmode')).toBe('disable');
    expect(out.pathname).toBe('/db');
  });
});

import { createHmac } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CourseAccessService } from '../services/course-access.service.js';
import { PlaybackService } from '../services/playback.service.js';
import { PlaybackUrlService } from '../services/playback-url.service.js';

const student: JwtPayload = {
  sub: 7,
  email: 's@x.com',
  roleId: 2,
  role: 'student',
  permissions: [],
};
const author: JwtPayload = { ...student, sub: 1, role: 'instructor' };

describe('PlaybackUrlService', () => {
  const NOW = Date.UTC(2026, 0, 1);
  afterEach(() => {
    delete process.env.PLAYBACK_SIGNING_SECRET;
    delete process.env.PLAYBACK_URL_TTL_SEC;
  });

  it('returns the stored URL unsigned when no secret is configured', () => {
    expect(new PlaybackUrlService().sign('https://cdn.x/v/1.mp4')).toEqual({
      url: 'https://cdn.x/v/1.mp4',
      kind: 'file',
      expiresAt: null,
    });
  });

  it('detects HLS playlists, with or without a query string', () => {
    const svc = new PlaybackUrlService();
    expect(svc.sign('https://cdn.x/v/index.m3u8').kind).toBe('hls');
    expect(svc.sign('https://cdn.x/v/index.M3U8?token=1').kind).toBe('hls');
    expect(svc.sign('https://cdn.x/v/1.mp4').kind).toBe('file');
  });

  it('signs the path and expiry with HMAC-SHA256', () => {
    process.env.PLAYBACK_SIGNING_SECRET = 's3cret';
    process.env.PLAYBACK_URL_TTL_SEC = '60';
    const out = new PlaybackUrlService().sign('https://cdn.x/v/a.m3u8', NOW);
    const url = new URL(out.url);
    const expires = Math.floor(NOW / 1000) + 60;
    expect(url.searchParams.get('expires')).toBe(String(expires));
    expect(url.searchParams.get('sig')).toBe(
      createHmac('sha256', 's3cret')
        .update(`/v/a.m3u8\n${expires}`)
        .digest('hex'),
    );
    expect(out.expiresAt).toBe(new Date(expires * 1000).toISOString());
    expect(out.kind).toBe('hls');
  });

  it('gives a different signature for another path', () => {
    process.env.PLAYBACK_SIGNING_SECRET = 's3cret';
    const svc = new PlaybackUrlService();
    const a = new URL(svc.sign('https://cdn.x/a.mp4', NOW).url);
    const b = new URL(svc.sign('https://cdn.x/b.mp4', NOW).url);
    expect(a.searchParams.get('sig')).not.toBe(b.searchParams.get('sig'));
  });
});

describe('PlaybackService.resolve', () => {
  const make = (
    opts: {
      lesson?: object | null;
      enrollment?: object | null;
      completed?: number[];
    } = {},
  ) => {
    const lesson =
      opts.lesson === undefined
        ? {
            id: 2,
            lessonType: 'video',
            contentUrlEn: 'https://cdn.x/2.mp4',
            isPreview: false,
            section: {
              courseId: 1,
              course: { authorId: 1, status: 'published', price: 0 },
            },
          }
        : opts.lesson;
    const prisma = {
      lesson: { findFirst: vi.fn().mockResolvedValue(lesson) },
      enrollment: {
        findFirst: vi
          .fn()
          .mockResolvedValue(
            opts.enrollment === undefined ? { payment: null } : opts.enrollment,
          ),
      },
      courseSection: {
        findMany: vi.fn().mockResolvedValue([
          {
            lessons: [
              { id: 1, durationSec: 10 },
              { id: 2, durationSec: 10 },
            ],
          },
        ]),
      },
      lessonProgress: {
        findMany: vi
          .fn()
          .mockResolvedValue(
            (opts.completed ?? []).map((lessonId) => ({ lessonId })),
          ),
      },
    };
    const db = prisma as unknown as PrismaService;
    return new PlaybackService(
      db,
      new CourseAccessService(db),
      new PlaybackUrlService(),
    );
  };

  it('hands the video to an enrolled learner whose previous lesson is done', async () => {
    const out = await make({ completed: [1] }).resolve(2, student);
    expect(out).toMatchObject({ url: 'https://cdn.x/2.mp4', kind: 'file' });
  });

  it('refuses a learner who is not enrolled', async () => {
    await expect(
      make({ enrollment: null }).resolve(2, student),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a lesson that is still locked', async () => {
    await expect(make().resolve(2, student)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('asks for payment on paid content, but not on a free preview', async () => {
    const paidCourse = (isPreview: boolean) => ({
      id: 2,
      lessonType: 'video',
      contentUrlEn: 'https://cdn.x/2.mp4',
      isPreview,
      section: {
        courseId: 1,
        course: { authorId: 1, status: 'published', price: 50 },
      },
    });
    await expect(
      make({ lesson: paidCourse(false), completed: [1] }).resolve(2, student),
    ).rejects.toMatchObject({ status: 402 });
    await expect(
      make({ lesson: paidCourse(true), completed: [1] }).resolve(2, student),
    ).resolves.toMatchObject({ url: 'https://cdn.x/2.mp4' });
  });

  it('always lets the author watch', async () => {
    const out = await make({ enrollment: null }).resolve(2, author);
    expect(out.url).toBe('https://cdn.x/2.mp4');
  });

  it('hides unpublished courses from learners but not from the author', async () => {
    const draft = {
      id: 2,
      lessonType: 'video',
      contentUrlEn: 'https://cdn.x/2.mp4',
      isPreview: false,
      section: {
        courseId: 1,
        course: { authorId: 1, status: 'draft', price: 0 },
      },
    };
    await expect(
      make({ lesson: draft }).resolve(2, student),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      make({ lesson: draft }).resolve(2, author),
    ).resolves.toBeDefined();
  });

  it('404s for text lessons and lessons without a video', async () => {
    const noVideo = (extra: object) => ({
      id: 2,
      lessonType: 'video',
      contentUrlEn: 'https://cdn.x/2.mp4',
      isPreview: false,
      section: {
        courseId: 1,
        course: { authorId: 1, status: 'published', price: 0 },
      },
      ...extra,
    });
    await expect(
      make({ lesson: noVideo({ lessonType: 'text' }) }).resolve(2, author),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      make({ lesson: noVideo({ contentUrlEn: null }) }).resolve(2, author),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      make({ lesson: null }).resolve(2, author),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

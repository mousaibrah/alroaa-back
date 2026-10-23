import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { vi } from 'vitest';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { MediaService } from '../../media/services/media.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CourseAccessService } from '../services/course-access.service.js';
import { LessonsService } from '../services/lessons.service.js';

const author: JwtPayload = {
  sub: 1,
  email: 'a@x.com',
  roleId: 2,
  role: 'instructor',
  permissions: [],
};

const dto = { titleEn: 'L', titleAr: 'L', lessonType: 'video' as const };

const tempFile = async () => {
  const path = join(tmpdir(), `lesson-spec-${Date.now()}-${Math.random()}`);
  await writeFile(path, 'x');
  return { path, originalname: 'a.mp4', mimetype: 'video/mp4', size: 1 };
};

const make = (createFails = false) => {
  const calls: string[] = [];
  const prisma = {
    lesson: {
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: 2 } }),
      create: vi.fn(({ data }) => {
        calls.push('create');
        return createFails
          ? Promise.reject(new Error('db down'))
          : Promise.resolve({
              id: 9,
              ...data,
              contentUrl: data.contentUrl,
              contentMedia: { status: 'uploaded' },
            });
      }),
    },
  };
  const media = {
    storeLessonFile: vi.fn(() => {
      calls.push('store');
      return Promise.resolve({ id: 'm1', key: 'media/m1.mp4' });
    }),
    enqueue: vi.fn(() => {
      calls.push('enqueue');
      return Promise.resolve();
    }),
    removeIfUnused: vi.fn().mockResolvedValue(undefined),
    publicUrl: (key: string) => `http://s3/alroaa/${key}`,
  };
  const access = { sectionForManage: vi.fn().mockResolvedValue({}) };
  const service = new LessonsService(
    prisma as unknown as PrismaService,
    access as unknown as CourseAccessService,
    media as unknown as MediaService,
  );
  return { service, prisma, media, calls };
};

describe('LessonsService.create', () => {
  it('stores the file, saves the lesson, then queues processing', async () => {
    const { service, prisma, calls } = make();
    const file = await tempFile();
    const out = await service.create(3, author, dto, file);

    expect(calls).toEqual(['store', 'create', 'enqueue']);
    expect(prisma.lesson.create.mock.calls[0][0].data).toMatchObject({
      contentMediaId: 'm1',
      contentUrl: 'http://s3/alroaa/media/m1.mp4',
      durationSec: undefined,
      sortOrder: 3,
    });
    expect(out).toMatchObject({
      contentUrl: 'http://s3/alroaa/media/m1.mp4',
      contentStatus: 'processing',
    });
    expect(out).not.toHaveProperty('contentMedia');
    expect(existsSync(file.path)).toBe(false);
  });

  it('requires a file', async () => {
    await expect(make().service.create(3, author, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('deletes the stored file and queues nothing when saving fails', async () => {
    const { service, media } = make(true);
    const file = await tempFile();
    await expect(service.create(3, author, dto, file)).rejects.toThrow(
      'db down',
    );
    expect(media.removeIfUnused).toHaveBeenCalledWith('m1');
    expect(media.enqueue).not.toHaveBeenCalled();
    expect(existsSync(file.path)).toBe(false);
  });
});

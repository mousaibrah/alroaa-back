import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { vi } from 'vitest';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { MediaService } from '../../media/services/media.service.js';
import type { MediaQueueService } from '../../media/services/media-queue.service.js';
import type { StorageService } from '../../media/services/storage.service.js';
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

const tempFile = async (mimetype = 'video/mp4') => {
  const path = join(tmpdir(), `lesson-spec-${Date.now()}-${Math.random()}`);
  await writeFile(path, 'x');
  return { path, originalname: 'a.mp4', mimetype, size: 1 };
};

// LessonsService with a real MediaService over mocked storage, queue and DB.
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
              contentMedia: { status: 'uploaded' },
            });
      }),
      count: vi.fn().mockResolvedValue(0),
    },
    course: { count: vi.fn().mockResolvedValue(0) },
    user: { count: vi.fn().mockResolvedValue(0) },
    media: {
      create: vi.fn(({ data }) => Promise.resolve(data)),
      findUnique: vi.fn(({ where }) =>
        Promise.resolve({
          id: where.id,
          key: 'media/up.mp4',
          variants: null,
          ownerId: 1,
          type: 'video',
          status: 'uploaded',
          isPrivate: false,
        }),
      ),
      delete: vi.fn(),
    },
  };
  const storage = {
    putObject: vi.fn(() => {
      calls.push('store');
      return Promise.resolve();
    }),
    deleteObjects: vi.fn(),
    getPublicUrl: (key: string) => `http://s3/alroaa/${key}`,
  };
  const queue = {
    enqueue: vi.fn(() => {
      calls.push('enqueue');
      return Promise.resolve();
    }),
  };
  const media = new MediaService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    queue as unknown as MediaQueueService,
  );
  const access = { sectionForManage: vi.fn().mockResolvedValue({}) };
  const service = new LessonsService(
    prisma as unknown as PrismaService,
    access as unknown as CourseAccessService,
    media,
  );
  return { service, prisma, storage, queue, calls };
};

describe('LessonsService.create', () => {
  it('stores the file, saves the lesson with its URL, then queues processing', async () => {
    const { service, prisma, calls } = make();
    const file = await tempFile();
    const out = await service.create(3, author, dto, file);

    expect(calls).toEqual(['store', 'create', 'enqueue']);
    const data = prisma.lesson.create.mock.calls[0][0].data;
    expect(data.contentMediaId).toEqual(expect.any(String));
    expect(data.contentUrl).toMatch(/^http:\/\/s3\/alroaa\/media\/.+\.mp4$/);
    expect(data).toMatchObject({ durationSec: undefined, sortOrder: 3 });
    expect(out).toMatchObject({
      contentUrl: data.contentUrl,
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

  it('rejects a file of the wrong type and removes the temp file', async () => {
    const { service, storage } = make();
    const file = await tempFile('image/png');
    await expect(service.create(3, author, dto, file)).rejects.toThrow(
      'The file must be a video',
    );
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(existsSync(file.path)).toBe(false);
  });

  it('deletes the stored file and queues nothing when saving fails', async () => {
    const { service, storage, queue } = make(true);
    const file = await tempFile();
    await expect(service.create(3, author, dto, file)).rejects.toThrow(
      'db down',
    );
    expect(storage.deleteObjects).toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(existsSync(file.path)).toBe(false);
  });
});

describe('LessonsService.create with an uploaded file', () => {
  const mediaId = '6f1c1c1e-6a51-4a9c-9a0e-3f6c2b8e1a11';

  it('attaches the media without storing or queueing again', async () => {
    const { service, prisma, calls } = make();
    await service.create(3, author, { ...dto, contentMediaId: mediaId });
    expect(calls).toEqual(['create']);
    expect(prisma.lesson.create.mock.calls[0][0].data).toMatchObject({
      contentMediaId: mediaId,
      contentUrl: 'http://s3/alroaa/media/up.mp4',
    });
  });

  it('refuses a file and contentMediaId together', async () => {
    const file = await tempFile();
    await expect(
      make().service.create(
        3,
        author,
        { ...dto, contentMediaId: mediaId },
        file,
      ),
    ).rejects.toThrow('not both');
  });

  it('refuses media of the wrong type', async () => {
    await expect(
      make().service.create(3, author, {
        ...dto,
        lessonType: 'text',
        contentMediaId: mediaId,
      }),
    ).rejects.toThrow('The file must be an image');
  });
});

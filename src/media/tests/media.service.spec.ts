import { BadRequestException, ConflictException } from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../services/media.service.js';
import type { MediaQueueService } from '../services/media-queue.service.js';
import type { StorageService } from '../services/storage.service.js';

const user: JwtPayload = {
  sub: 5,
  email: 'i@x.com',
  roleId: 2,
  role: 'instructor',
  permissions: [],
};

const row = (over: object = {}) => ({
  id: 'm1',
  ownerId: 5,
  key: 'media/2026/10/m1.mp4',
  type: 'video',
  mimeType: 'video/mp4',
  size: 100n,
  status: 'pending',
  isPrivate: true,
  durationSec: 30,
  variants: null,
  thumbnailKey: null,
  ...over,
});

const make = (
  media: object | null,
  extra: { head?: object | null; used?: number } = {},
) => {
  const prisma = {
    media: {
      findUnique: vi.fn().mockResolvedValue(media),
      create: vi.fn().mockResolvedValue(media),
      update: vi.fn().mockImplementation(({ data }) => ({ ...media, ...data })),
      delete: vi.fn(),
    },
    lesson: { count: vi.fn().mockResolvedValue(extra.used ?? 0) },
    course: { count: vi.fn().mockResolvedValue(0) },
    user: { count: vi.fn().mockResolvedValue(0) },
  };
  const storage = {
    headObject: vi.fn().mockResolvedValue(extra.head ?? null),
    deleteObjects: vi.fn(),
    createPresignedPutUrl: vi.fn().mockResolvedValue('https://put'),
    createPresignedGetUrl: vi.fn().mockResolvedValue('https://get'),
    getPublicUrl: vi.fn().mockReturnValue('https://public'),
    createMultipartUpload: vi.fn().mockResolvedValue('u1'),
    createPresignedPartUrl: vi.fn().mockResolvedValue('https://part'),
    listParts: vi.fn().mockResolvedValue([]),
    completeMultipartUpload: vi.fn(),
    abortMultipartUpload: vi.fn(),
  };
  const queue = { enqueue: vi.fn() };
  const service = new MediaService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    queue as unknown as MediaQueueService,
  );
  return { service, prisma, storage, queue };
};

describe('MediaService.confirm', () => {
  it('marks UPLOADED and enqueues when the object matches', async () => {
    const { service, queue } = make(row(), {
      head: { size: 100, contentType: 'video/mp4' },
    });
    await service.confirm('m1', user);
    expect(queue.enqueue).toHaveBeenCalledWith('m1');
  });

  it('deletes the object and marks FAILED on a size mismatch', async () => {
    const { service, storage, prisma, queue } = make(row(), {
      head: { size: 999, contentType: 'video/mp4' },
    });
    await expect(service.confirm('m1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.deleteObjects).toHaveBeenCalledWith([
      'media/2026/10/m1.mp4',
    ]);
    expect(prisma.media.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('fails on a content-type mismatch and when nothing was uploaded', async () => {
    const wrongType = make(row(), {
      head: { size: 100, contentType: 'text/html' },
    });
    await expect(wrongType.service.confirm('m1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const missing = make(row(), { head: null });
    await expect(missing.service.confirm('m1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('MediaService.remove', () => {
  it('refuses when a lesson references the media', async () => {
    const { service, storage } = make(row(), { used: 1 });
    await expect(service.remove('m1', user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });

  it('removes every object and the row otherwise', async () => {
    const media = row({
      thumbnailKey: 'media/t.webp',
      variants: { mp4: { key: 'media/w.mp4' } },
    });
    const { service, storage, prisma } = make(media);
    await service.remove('m1', user);
    expect(storage.deleteObjects).toHaveBeenCalledWith([
      'media/2026/10/m1.mp4',
      'media/t.webp',
      'media/w.mp4',
    ]);
    expect(prisma.media.delete).toHaveBeenCalled();
  });
});

describe('MediaService.playbackSource', () => {
  it('signs private videos (the web MP4) for an hour, public ones are plain', async () => {
    const { service } = make(null);
    const priv = await service.playbackSource({
      status: 'ready',
      key: 'k',
      isPrivate: true,
      variants: { mp4: { key: 'w.mp4' } },
    } as never);
    expect(priv.url).toBe('https://get');
    expect(priv.expiresAt).not.toBeNull();
    const pub = await service.playbackSource({
      status: 'ready',
      key: 'k',
      isPrivate: false,
      variants: null,
    } as never);
    expect(pub).toMatchObject({ url: 'https://public', expiresAt: null });
  });
});

describe('MediaService multipart uploads', () => {
  const big = (over: object = {}) =>
    row({ size: BigInt(40 * 1024 * 1024), isPrivate: false, ...over });
  const withMultipart = (media: object, parts: number) => {
    const made = make(media, {
      head: { size: 40 * 1024 * 1024, contentType: 'video/mp4' },
    });
    made.storage.listParts.mockResolvedValue(
      Array.from({ length: parts }, (_, i) => ({
        PartNumber: i + 1,
        ETag: `"e${i}"`,
      })),
    );
    return made;
  };

  it('starts with 16 MB parts', async () => {
    const { service } = withMultipart(big(), 0);
    const out = await service.startMultipart(user, {
      filename: 'a.mp4',
      mimeType: 'video/mp4',
      size: 40 * 1024 * 1024,
    });
    expect(out).toMatchObject({
      uploadId: 'u1',
      partSize: 16 * 1024 * 1024,
      partCount: 3,
    });
  });

  it('refuses part numbers past the end', async () => {
    const { service } = withMultipart(big(), 0);
    await expect(
      service.signPart('m1', user, { uploadId: 'u1', partNumber: 4 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.signPart('m1', user, { uploadId: 'u1', partNumber: 3 }),
    ).resolves.toEqual({ url: 'https://part' });
  });

  it('completes, verifies and queues once every part is there', async () => {
    const { service, storage, queue } = withMultipart(big(), 3);
    await service.completeMultipart('m1', user, 'u1');
    expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
      'media/2026/10/m1.mp4',
      'u1',
      expect.arrayContaining([{ PartNumber: 1, ETag: '"e0"' }]),
    );
    expect(queue.enqueue).toHaveBeenCalledWith('m1');
  });

  it('does not complete with missing parts', async () => {
    const { service, storage } = withMultipart(big(), 2);
    await expect(
      service.completeMultipart('m1', user, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it('aborts and drops the row', async () => {
    const { service, storage, prisma } = withMultipart(big(), 0);
    await service.abortMultipart('m1', user, 'u1');
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      'media/2026/10/m1.mp4',
      'u1',
    );
    expect(prisma.media.delete).toHaveBeenCalled();
  });
});

describe('MediaService.attachable', () => {
  it('returns the public URL of an uploaded file of the right type', async () => {
    const { service } = make(row({ status: 'uploaded', isPrivate: false }));
    await expect(service.attachable('m1', 'video', user)).resolves.toEqual({
      mediaId: 'm1',
      url: 'https://public',
    });
  });

  it('refuses unfinished, private and wrong-type files', async () => {
    const pending = make(row({ isPrivate: false }));
    await expect(
      pending.service.attachable('m1', 'video', user),
    ).rejects.toThrow('The upload has not finished');
    const priv = make(row({ status: 'ready' }));
    await expect(priv.service.attachable('m1', 'video', user)).rejects.toThrow(
      'Private files',
    );
    const image = make(row({ status: 'ready', isPrivate: false }));
    await expect(image.service.attachable('m1', 'image', user)).rejects.toThrow(
      'The file must be an image',
    );
  });
});

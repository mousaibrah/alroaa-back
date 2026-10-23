import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CourseAccessService } from '../services/course-access.service.js';
import { assertSameIds } from '../utils/reorder.util.js';
import { SectionsService } from '../services/sections.service.js';
import { CoursesService } from '../services/courses.service.js';
import type { MediaService } from '../../media/services/media.service.js';

const user = (sub: number, role = 'instructor'): JwtPayload => ({
  sub,
  email: 'u@example.com',
  roleId: 1,
  role,
  permissions: [],
});

describe('assertSameIds', () => {
  it('accepts the same ids in any order', () => {
    expect(() => assertSameIds([1, 2, 3], [3, 1, 2])).not.toThrow();
  });

  it.each([
    ['a missing id', [1, 2, 3], [1, 2]],
    ['an unknown id', [1, 2, 3], [1, 2, 9]],
    ['an extra id', [1, 2], [1, 2, 3]],
    ['a duplicate', [1, 2, 3], [1, 1, 2]],
  ])('rejects %s', (_name, existing, requested) => {
    expect(() => assertSameIds(existing, requested)).toThrow(
      BadRequestException,
    );
  });
});

describe('CourseAccessService', () => {
  const prisma = { course: { findFirst: vi.fn() } };
  const access = new CourseAccessService(prisma as unknown as PrismaService);

  beforeEach(() => prisma.course.findFirst.mockReset());

  it('lets the author manage the course', async () => {
    prisma.course.findFirst.mockResolvedValue({ id: 1, authorId: 5 });
    await expect(access.courseForManage(1, user(5))).resolves.toBeDefined();
  });

  it("forbids another instructor from managing someone else's course", async () => {
    prisma.course.findFirst.mockResolvedValue({ id: 1, authorId: 5 });
    await expect(access.courseForManage(1, user(6))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets an admin manage any course', async () => {
    prisma.course.findFirst.mockResolvedValue({ id: 1, authorId: 5 });
    await expect(
      access.courseForManage(1, user(99, 'admin')),
    ).resolves.toBeDefined();
  });

  it('returns 404 for a missing or deleted course', async () => {
    prisma.course.findFirst.mockResolvedValue(null);
    await expect(access.courseForManage(1, user(5))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

interface UpdateArgs {
  where: { id: number };
  data: { sortOrder: number };
}
interface CreateArgs {
  data: { sortOrder: number };
}

describe('SectionsService', () => {
  const makeService = () => {
    const prisma = {
      courseSection: {
        findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]),
        update: vi.fn((args: UpdateArgs) => args),
        aggregate: vi.fn(),
        create: vi.fn((args: CreateArgs) => args),
      },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    const access = { courseForManage: vi.fn().mockResolvedValue({ id: 10 }) };
    const service = new SectionsService(
      prisma as unknown as PrismaService,
      access as unknown as CourseAccessService,
    );
    return { prisma, service };
  };

  it('writes sortOrder equal to the position in the requested list', async () => {
    const { prisma, service } = makeService();
    await service.reorder(10, user(5), [3, 1, 2]);
    expect(
      prisma.courseSection.update.mock.calls.map(([a]) => [
        a.where.id,
        a.data.sortOrder,
      ]),
    ).toEqual([
      [3, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('refuses a reorder that omits a section', async () => {
    const { prisma, service } = makeService();
    await expect(service.reorder(10, user(5), [1, 2])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('appends a new section after the current last one', async () => {
    const { prisma, service } = makeService();
    prisma.courseSection.aggregate.mockResolvedValue({
      _max: { sortOrder: 4 },
    });
    await service.create(10, user(5), { titleEn: 'New', titleAr: 'New' });
    expect(prisma.courseSection.create.mock.calls[0][0].data.sortOrder).toBe(5);
  });

  it('starts the first section at 0', async () => {
    const { prisma, service } = makeService();
    prisma.courseSection.aggregate.mockResolvedValue({
      _max: { sortOrder: null },
    });
    await service.create(10, user(5), { titleEn: 'First', titleAr: 'First' });
    expect(prisma.courseSection.create.mock.calls[0][0].data.sortOrder).toBe(0);
  });
});

describe('CoursesService cover and intro video upload', () => {
  const file = (name: string, mimetype: string) => ({
    path: `/tmp/course-spec-${name}`,
    originalname: name,
    mimetype,
    size: 1,
  });
  const cover = file('c.png', 'image/png');
  const intro = file('i.mp4', 'video/mp4');
  const row = (data: object) => ({
    id: 1,
    price: 0,
    thumbnailMedia: null,
    ...data,
  });

  const make = () => {
    const prisma = {
      course: {
        create: vi.fn(({ data }) => Promise.resolve(row(data))),
        // Like Prisma: the whole row, with the fields that were not changed.
        update: vi.fn(({ data }) =>
          Promise.resolve(
            row({
              thumbnailMediaId: 'img1',
              introVideoMediaId: 'vid1',
              ...data,
            }),
          ),
        ),
      },
    };
    const media = {
      // Stands in for MediaService.withUpload: images are "stored" as img2,
      // videos as vid2.
      withUpload: vi.fn((f, type, _user, save) =>
        save(
          f
            ? type === 'image'
              ? { mediaId: 'img2', url: 'http://s3/c.png' }
              : { mediaId: 'vid2', url: 'http://s3/i.mp4' }
            : undefined,
        ),
      ),
      removeIfUnused: vi.fn().mockResolvedValue(undefined),
      publicUrl: (key: string) => key,
      attachable: vi.fn((mediaId: string) =>
        Promise.resolve({ mediaId, url: `http://s3/${mediaId}` }),
      ),
    };
    const access = {
      courseForManage: vi.fn().mockResolvedValue({
        id: 1,
        thumbnailMediaId: 'img1',
        introVideoMediaId: 'vid1',
      }),
    };
    const service = new CoursesService(
      prisma as unknown as PrismaService,
      access as unknown as CourseAccessService,
      media as unknown as MediaService,
    );
    return { service, prisma, media };
  };

  it('saves the uploaded cover and intro video on create', async () => {
    const { service, prisma } = make();
    const out = await service.create(
      user(5),
      { titleEn: 'A', titleAr: 'A' },
      { thumbnail: [cover], introVideo: [intro] },
    );
    expect(prisma.course.create.mock.calls[0][0].data).toMatchObject({
      thumbnailUrl: 'http://s3/c.png',
      thumbnailMediaId: 'img2',
      introVideoUrl: 'http://s3/i.mp4',
      introVideoMediaId: 'vid2',
    });
    expect(out).toMatchObject({
      thumbnailUrl: 'http://s3/c.png',
      introVideoUrl: 'http://s3/i.mp4',
    });
  });

  it('replaces only the intro video on update and deletes the old one', async () => {
    const { service, prisma, media } = make();
    await service.update(1, user(5), {}, { introVideo: [intro] });
    const data = prisma.course.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ introVideoMediaId: 'vid2' });
    expect(data).not.toHaveProperty('thumbnailMediaId');
    expect(media.removeIfUnused).toHaveBeenCalledTimes(1);
    expect(media.removeIfUnused).toHaveBeenCalledWith('vid1');
  });

  it('keeps both files when none is sent', async () => {
    const { service, prisma, media } = make();
    await service.update(1, user(5), { titleEn: 'B' });
    const data = prisma.course.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('thumbnailMediaId');
    expect(data).not.toHaveProperty('introVideoMediaId');
    expect(media.removeIfUnused).not.toHaveBeenCalled();
  });

  const uploadedId = '6f1c1c1e-6a51-4a9c-9a0e-3f6c2b8e1a11';

  it('attaches an intro video uploaded beforehand and deletes the old one', async () => {
    const { service, prisma, media } = make();
    await service.update(1, user(5), { introVideoMediaId: uploadedId });
    expect(media.attachable).toHaveBeenCalledWith(
      uploadedId,
      'video',
      expect.anything(),
    );
    const data = prisma.course.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      introVideoMediaId: uploadedId,
      introVideoUrl: `http://s3/${uploadedId}`,
    });
    expect(data).not.toHaveProperty('thumbnailMediaId');
    expect(media.removeIfUnused).toHaveBeenCalledWith('vid1');
    expect(media.removeIfUnused).toHaveBeenCalledTimes(1);
  });

  it('keeps the file when the same media id is sent again', async () => {
    const { service, media } = make();
    await service.update(1, user(5), { thumbnailMediaId: 'img1' });
    expect(media.removeIfUnused).not.toHaveBeenCalled();
  });

  it('refuses a file and a media id for the same field', async () => {
    const { service } = make();
    await expect(
      service.create(
        user(5),
        { titleEn: 'A', titleAr: 'A', introVideoMediaId: uploadedId },
        { introVideo: [intro] },
      ),
    ).rejects.toThrow('not both');
  });
});

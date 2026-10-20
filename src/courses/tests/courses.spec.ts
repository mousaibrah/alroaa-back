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

import { ConflictException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { MediaService } from '../../media/services/media.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from '../services/users.service.js';

const me: JwtPayload = {
  sub: 7,
  email: 'u@x.com',
  roleId: 2,
  role: 'user',
  permissions: [],
};
const picture = {
  path: '/tmp/users-spec-a.png',
  originalname: 'a.png',
  mimetype: 'image/png',
  size: 1,
};

const make = (current: { imageMediaId: string | null } | null) => {
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue(current),
      update: vi.fn(({ data }) =>
        Promise.resolve({ id: 7, gender: null, dob: null, ...data }),
      ),
    },
  };
  const media = {
    // Stands in for MediaService.withUpload: the file is "stored" as img2.
    withUpload: vi.fn((_file, _type, _user, save) =>
      save({ mediaId: 'img2', url: 'http://s3/a.png' }),
    ),
    removeIfUnused: vi.fn().mockResolvedValue(undefined),
  };
  const service = new UsersService(
    prisma as unknown as PrismaService,
    media as unknown as MediaService,
  );
  return { service, prisma, media };
};

describe('UsersService.updateImage', () => {
  it('saves the new picture and deletes the old one', async () => {
    const { service, prisma, media } = make({ imageMediaId: 'img1' });
    const out = await service.updateImage(me, picture);
    expect(media.withUpload.mock.calls[0][1]).toBe('image');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { image: 'http://s3/a.png', imageMediaId: 'img2' },
    });
    expect(media.removeIfUnused).toHaveBeenCalledWith('img1');
    expect(out.image).toBe('http://s3/a.png');
  });

  it('deletes nothing when there was no picture', async () => {
    const { service, media } = make({ imageMediaId: null });
    await service.updateImage(me, picture);
    expect(media.removeIfUnused).not.toHaveBeenCalled();
  });

  it('404s for a deleted account without storing anything', async () => {
    const { service, media } = make(null);
    await expect(service.updateImage(me, picture)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(media.withUpload).not.toHaveBeenCalled();
  });
});

describe('UsersService.updateProfile', () => {
  const makeProfile = () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 7,
          gender: null,
          dob: null,
          countryCode: '+966',
          phoneNumber: '501234567',
        }),
        update: vi.fn(({ data }) =>
          Promise.resolve({ id: 7, gender: null, dob: null, ...data }),
        ),
      },
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      {} as MediaService,
    );
    return { service, prisma };
  };

  it('updates the given fields and clears gender with null', async () => {
    const { service, prisma } = makeProfile();
    await service.updateProfile(7, { firstName: ' Sam ', gender: null });
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      firstName: 'Sam',
      lastName: undefined,
      gender: null,
      dob: undefined,
      countryCode: undefined,
      phoneNumber: undefined,
    });
  });

  it('changes the phone number and keeps the current dialing code', async () => {
    const { service, prisma } = makeProfile();
    // findById, then the duplicate check finds nobody.
    prisma.user.findFirst
      .mockResolvedValueOnce({
        id: 7,
        countryCode: '+966',
        phoneNumber: '501234567',
      })
      .mockResolvedValueOnce(null);
    await service.updateProfile(7, { phoneNumber: '055 000 1111' });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
      countryCode: '+966',
      phoneNumber: '550001111',
    });
  });

  it('changes only the dialing code of the current number', async () => {
    const { service, prisma } = makeProfile();
    prisma.user.findFirst
      .mockResolvedValueOnce({
        id: 7,
        countryCode: '+966',
        phoneNumber: '791234567',
      })
      .mockResolvedValueOnce(null);
    await service.updateProfile(7, { countryCode: '962' });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
      countryCode: '+962',
      phoneNumber: '791234567',
    });
  });

  it('asks for a number when the account has none', async () => {
    const { service, prisma } = makeProfile();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: 7,
      countryCode: '+966',
      phoneNumber: null,
    });
    await expect(
      service.updateProfile(7, { countryCode: '+962' }),
    ).rejects.toThrow('phoneNumber is required');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses a number that belongs to another account', async () => {
    const { service, prisma } = makeProfile();
    prisma.user.findFirst
      .mockResolvedValueOnce({
        id: 7,
        countryCode: '+966',
        phoneNumber: '501234567',
      })
      .mockResolvedValueOnce({ id: 9 });
    await expect(
      service.updateProfile(7, { phoneNumber: '0550001111' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('accepts re-sending your own number', async () => {
    const { service, prisma } = makeProfile();
    prisma.user.findFirst
      .mockResolvedValueOnce({
        id: 7,
        countryCode: '+966',
        phoneNumber: '501234567',
      })
      .mockResolvedValueOnce({ id: 7 });
    await service.updateProfile(7, { phoneNumber: '0501234567' });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('refuses a date of birth in the future', async () => {
    const { service, prisma } = makeProfile();
    await expect(
      service.updateProfile(7, { dob: '2999-01-01' }),
    ).rejects.toThrow('dob cannot be in the future');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

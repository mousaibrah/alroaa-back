import type { JwtService } from '@nestjs/jwt';
import type { MediaService } from '../../media/services/media.service.js';
import type { UsersService } from '../../users/services/users.service.js';
import { AuthService } from '../services/auth.service.js';

const dto = {
  firstName: 'A',
  lastName: 'B',
  email: 'New@X.com',
  password: '12345678',
  phoneNumber: '050 123 4567',
};
const picture = {
  path: '/tmp/register-spec-a.png',
  originalname: 'a.png',
  mimetype: 'image/png',
  size: 1,
};

const make = () => {
  const users = {
    findByEmail: vi.fn().mockResolvedValue(undefined),
    findByPhone: vi.fn().mockResolvedValue(undefined),
    findRoleIdByName: vi.fn().mockResolvedValue(2),
    create: vi.fn((data) => Promise.resolve({ id: 11, ...data })),
    findAccessByRoleId: vi
      .fn()
      .mockResolvedValue({ role: 'user', permissions: [] }),
  };
  const media = {
    withUpload: vi.fn((file, _type, _user, save) =>
      save(file ? { mediaId: 'img1', url: 'http://s3/a.png' } : undefined),
    ),
    setOwner: vi.fn().mockResolvedValue(undefined),
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('token') };
  const service = new AuthService(
    users as unknown as UsersService,
    jwt as unknown as JwtService,
    media as unknown as MediaService,
  );
  return { service, users, media };
};

describe('AuthService.register', () => {
  it('always registers as `user`', async () => {
    const { service, users } = make();
    const out = await service.register(dto);
    expect(users.findRoleIdByName).toHaveBeenCalledWith('user');
    expect(out.role).toBe('user');
  });

  it('stores the picture with no owner, then gives it to the new user', async () => {
    const { service, users, media } = make();
    const out = await service.register(dto, picture);
    expect(media.withUpload.mock.calls[0].slice(1, 3)).toEqual(['image', null]);
    expect(users.create.mock.calls[0][0]).toMatchObject({
      email: 'new@x.com',
      image: 'http://s3/a.png',
      imageMediaId: 'img1',
    });
    expect(media.setOwner).toHaveBeenCalledWith('img1', 11);
    expect(out.user.image).toBe('http://s3/a.png');
  });

  it('works without a picture', async () => {
    const { service, users, media } = make();
    await service.register(dto);
    expect(users.create.mock.calls[0][0]).toMatchObject({
      image: null,
      imageMediaId: null,
    });
    expect(media.setOwner).not.toHaveBeenCalled();
  });

  it('stores the phone as +966 and digits only by default', async () => {
    const { service, users } = make();
    await service.register(dto);
    expect(users.create.mock.calls[0][0]).toMatchObject({
      countryCode: '+966',
      phoneNumber: '501234567',
    });
  });

  it('rejects a Saudi number that is not a mobile', async () => {
    const { service, users } = make();
    await expect(
      service.register({ ...dto, phoneNumber: '0112345678' }),
    ).rejects.toThrow('Saudi phone numbers');
    expect(users.create).not.toHaveBeenCalled();
  });

  it('accepts other countries', async () => {
    const { service, users } = make();
    await service.register({
      ...dto,
      countryCode: '962',
      phoneNumber: '0791234567',
    });
    expect(users.create.mock.calls[0][0]).toMatchObject({
      countryCode: '+962',
      phoneNumber: '791234567',
    });
  });

  it('refuses a phone number that is already registered', async () => {
    const { service, users } = make();
    users.findByPhone.mockResolvedValue({ id: 3 });
    await expect(service.register(dto)).rejects.toThrow(
      'Phone number is already registered',
    );
  });
});

import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { MediaService } from '../../media/services/media.service.js';
import type { UsersService } from '../../users/services/users.service.js';
import { AuthService } from '../services/auth.service.js';
import type { JwtPayload } from '../types/jwt-payload.js';

const caller: JwtPayload = {
  sub: 7,
  email: 'me@x.com',
  roleId: 2,
  role: 'user',
  permissions: [],
};

const make = async (taken: object | undefined = undefined) => {
  const account = {
    id: 7,
    email: 'me@x.com',
    password: await bcrypt.hash('OldPass123', 4),
    roleId: 2,
  };
  const users = {
    findById: vi.fn().mockResolvedValue(account),
    findByEmail: vi.fn().mockResolvedValue(taken),
    updateCredentials: vi.fn((_id, data) =>
      Promise.resolve({ ...account, ...data }),
    ),
    findAccessByRoleId: vi
      .fn()
      .mockResolvedValue({ role: 'user', permissions: [] }),
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('fresh-token') };
  const service = new AuthService(
    users as unknown as UsersService,
    jwt as unknown as JwtService,
    {} as MediaService,
  );
  return { service, users };
};

describe('AuthService.changePassword', () => {
  it('needs the current password', async () => {
    const { service, users } = await make();
    await expect(
      service.changePassword(caller, {
        currentPassword: 'wrong',
        newPassword: 'NewPass123',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(users.updateCredentials).not.toHaveBeenCalled();
  });

  it('refuses the same password', async () => {
    const { service } = await make();
    await expect(
      service.changePassword(caller, {
        currentPassword: 'OldPass123',
        newPassword: 'OldPass123',
      }),
    ).rejects.toThrow('must differ');
  });

  it('stores a hash of the new password and returns a fresh token', async () => {
    const { service, users } = await make();
    const out = await service.changePassword(caller, {
      currentPassword: 'OldPass123',
      newPassword: 'NewPass123',
    });
    const { password } = users.updateCredentials.mock.calls[0][1];
    expect(password).not.toBe('NewPass123');
    expect(await bcrypt.compare('NewPass123', password)).toBe(true);
    expect(out.accessToken).toBe('fresh-token');
  });
});

describe('AuthService.changeEmail', () => {
  it('needs the current password', async () => {
    const { service } = await make();
    await expect(
      service.changeEmail(caller, {
        email: 'new@x.com',
        currentPassword: 'wrong',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an address another account uses', async () => {
    const { service } = await make({ id: 9 });
    await expect(
      service.changeEmail(caller, {
        email: 'taken@x.com',
        currentPassword: 'OldPass123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('saves the lower-cased address and returns a fresh token', async () => {
    const { service, users } = await make();
    const out = await service.changeEmail(caller, {
      email: 'New@X.com',
      currentPassword: 'OldPass123',
    });
    expect(users.updateCredentials).toHaveBeenCalledWith(7, {
      email: 'new@x.com',
    });
    expect(out.user.email).toBe('new@x.com');
    expect(out.accessToken).toBe('fresh-token');
  });
});

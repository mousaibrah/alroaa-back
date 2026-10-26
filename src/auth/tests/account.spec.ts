import { ForbiddenException } from '@nestjs/common';
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

const make = async () => {
  const account = {
    id: 7,
    email: 'me@x.com',
    password: await bcrypt.hash('OldPass123', 4),
    roleId: 2,
  };
  const users = {
    findById: vi.fn().mockResolvedValue(account),
    updatePassword: vi.fn((_id, password) =>
      Promise.resolve({ ...account, password }),
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
    expect(users.updatePassword).not.toHaveBeenCalled();
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
    const password = users.updatePassword.mock.calls[0][1];
    expect(password).not.toBe('NewPass123');
    expect(await bcrypt.compare('NewPass123', password)).toBe(true);
    expect(out.accessToken).toBe('fresh-token');
  });
});

import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator.js';
import { JwtAuthGuard } from '../guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../guards/permissions.guard.js';

const makeContext = (request: object): ExecutionContext => {
  const handler = () => undefined;
  class Controller {}
  return {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

const reflectorFor = (metadata: Record<string, unknown>) =>
  ({
    getAllAndOverride: (key: string) => metadata[key],
  }) as unknown as Reflector;

// The account behind a token, as the guard reads it.
// Verified unless the test says otherwise.
const accounts = (
  account: {
    isDeleted: boolean;
    passwordChangedAt: Date | null;
    emailVerifiedAt?: Date | null;
    email?: string;
  } | null = {
    isDeleted: false,
    passwordChangedAt: null,
  },
) =>
  ({
    user: {
      findUnique: vi.fn().mockResolvedValue(
        account && {
          emailVerifiedAt: new Date(),
          email: 'me@x.com',
          ...account,
        },
      ),
    },
  }) as unknown as PrismaService;

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: 'test-secret' });

  it('lets @Public routes through without a token', async () => {
    const guard = new JwtAuthGuard(
      jwt,
      reflectorFor({ [IS_PUBLIC_KEY]: true }),
      accounts(),
    );
    await expect(guard.canActivate(makeContext({ headers: {} }))).resolves.toBe(
      true,
    );
  });

  it('rejects a missing token', async () => {
    const guard = new JwtAuthGuard(jwt, reflectorFor({}), accounts());
    await expect(
      guard.canActivate(makeContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = await new JwtService({ secret: 'other' }).signAsync({
      sub: 1,
    });
    const guard = new JwtAuthGuard(jwt, reflectorFor({}), accounts());
    await expect(
      guard.canActivate(
        makeContext({ headers: { authorization: `Bearer ${forged}` } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the payload for a valid token', async () => {
    const token = await jwt.signAsync({
      sub: 1,
      permissions: ['courses.read'],
    });
    const request: { headers: object; user?: { sub: number } } = {
      headers: { authorization: `Bearer ${token}` },
    };
    const guard = new JwtAuthGuard(jwt, reflectorFor({}), accounts());
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user?.sub).toBe(1);
  });

  const bearer = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  it('refuses a token issued before the last password change', async () => {
    const token = await jwt.signAsync({ sub: 1 });
    const guard = new JwtAuthGuard(
      jwt,
      reflectorFor({}),
      accounts({
        isDeleted: false,
        passwordChangedAt: new Date(Date.now() + 5_000),
      }),
    );
    await expect(guard.canActivate(makeContext(bearer(token)))).rejects.toThrow(
      'Session has ended',
    );
  });

  it('refuses an unverified account with a code the frontend can act on', async () => {
    const token = await jwt.signAsync({ sub: 1 });
    const guard = new JwtAuthGuard(
      jwt,
      reflectorFor({}),
      accounts({
        isDeleted: false,
        passwordChangedAt: null,
        emailVerifiedAt: null,
        email: 'me@x.com',
      }),
    );
    const error = await guard
      .canActivate(makeContext(bearer(token)))
      .catch((e: UnauthorizedException) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
      email: 'me@x.com',
    });
  });

  it('treats an unverified account as a guest on public routes', async () => {
    const token = await jwt.signAsync({ sub: 1 });
    const request: { user?: unknown } & ReturnType<typeof bearer> =
      bearer(token);
    const guard = new JwtAuthGuard(
      jwt,
      reflectorFor({ [IS_PUBLIC_KEY]: true }),
      accounts({
        isDeleted: false,
        passwordChangedAt: null,
        emailVerifiedAt: null,
      }),
    );
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('accepts a token issued in the same second as the change', async () => {
    const token = await jwt.signAsync({ sub: 1 });
    const guard = new JwtAuthGuard(
      jwt,
      reflectorFor({}),
      accounts({ isDeleted: false, passwordChangedAt: new Date() }),
    );
    await expect(guard.canActivate(makeContext(bearer(token)))).resolves.toBe(
      true,
    );
  });

  it('refuses a token of a deleted account, but lets it browse public routes as a guest', async () => {
    const token = await jwt.signAsync({ sub: 1 });
    const deleted = accounts({ isDeleted: true, passwordChangedAt: null });
    await expect(
      new JwtAuthGuard(jwt, reflectorFor({}), deleted).canActivate(
        makeContext(bearer(token)),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const request: { headers: object; user?: unknown } = bearer(token);
    await expect(
      new JwtAuthGuard(
        jwt,
        reflectorFor({ [IS_PUBLIC_KEY]: true }),
        deleted,
      ).canActivate(makeContext(request)),
    ).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });
});

describe('PermissionsGuard', () => {
  it('allows routes with no required permissions', () => {
    const guard = new PermissionsGuard(reflectorFor({}));
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('allows when the user holds all required permissions', () => {
    const guard = new PermissionsGuard(
      reflectorFor({ [PERMISSIONS_KEY]: ['courses.read', 'courses.create'] }),
    );
    const request = {
      user: { permissions: ['courses.read', 'courses.create', 'x'] },
    };
    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('forbids when one required permission is missing', () => {
    const guard = new PermissionsGuard(
      reflectorFor({ [PERMISSIONS_KEY]: ['courses.read', 'courses.delete'] }),
    );
    const request = { user: { permissions: ['courses.read'] } };
    expect(() => guard.canActivate(makeContext(request))).toThrow(
      ForbiddenException,
    );
  });

  it('forbids when there is no user', () => {
    const guard = new PermissionsGuard(
      reflectorFor({ [PERMISSIONS_KEY]: ['courses.read'] }),
    );
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      ForbiddenException,
    );
  });
});
